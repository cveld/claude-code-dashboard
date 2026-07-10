"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDataRefresh, type ChangeEvent } from "@/app/lib/useDataRefresh";
import { IdeWindow, findIdeWindowForSlug, type TokenComponents } from "@/app/lib/dashboard";
import { buildMonitorToolCall } from "@/app/lib/monitorToolCall";
import { BurnedTokensTooltip } from "@/app/components/BurnedTokensTooltip";

// Shared so user- and assistant-messages render tables identically: each table
// gets its own overflow-x-auto wrapper so wide tables scroll within the bubble
// instead of stretching the transcript column. Relies on the bubble having
// `min-w-0` so the wrapper has a bounded width to scroll against.
const markdownComponents: Components = {
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
};

interface TranscriptMessage {
  type: "user" | "assistant" | "system" | "other";
  timestamp: string | null;
  text: string;
  uuid?: string;
}

interface SessionStats {
  currentContext: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  totalTokensBurned: number;
  perModel: Record<string, TokenComponents>;
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

function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`flex gap-3 animate-pulse ${i % 2 === 0 ? "flex-row-reverse" : "flex-row"}`}>
          <div className="shrink-0 w-7 h-7 rounded-full bg-zinc-800" />
          <div className={`h-12 rounded-xl bg-zinc-800 ${i % 2 === 0 ? "w-2/5" : "w-3/5"}`} />
        </div>
      ))}
    </div>
  );
}

function StatsBar({ stats }: { stats: SessionStats }) {
  const pct = Math.round((stats.currentContext / stats.contextWindowSize) * 100);
  const cacheTotal = stats.totalCacheCreation + stats.totalCacheRead;
  const cacheHitPct = cacheTotal > 0 ? Math.round((stats.totalCacheRead / cacheTotal) * 100) : null;
  return (
    <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center gap-4 flex-wrap">
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
      <BurnedTokensTooltip
        input={stats.totalInputTokens}
        cacheCreation={stats.totalCacheCreation}
        cacheRead={stats.totalCacheRead}
        output={stats.totalOutputTokens}
        perModel={stats.perModel ?? {}}
        align="left"
      >
        <span className="text-xs text-zinc-500 shrink-0">
          Burned <span className="text-zinc-300 tabular-nums">{fmtTokens(stats.totalTokensBurned)}</span>
        </span>
      </BurnedTokensTooltip>
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

export function TranscriptPanel({
  slug,
  id,
  onReadStateChange,
}: {
  slug: string;
  id: string;
  onReadStateChange?: () => void;
}) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [displayPath, setDisplayPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isRead, setIsRead] = useState(false);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [ideWindow, setIdeWindow] = useState<IdeWindow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false);
  const userMsgRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [stickyMsg, setStickyMsg] = useState<string | null>(null);
  const [stickyPulse, setStickyPulse] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [monitorActive, setMonitorActive] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSent, setChatSent] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

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

  function focusIde() {
    if (!ideWindow) return;
    fetch("/api/ide-windows/open-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port: ideWindow.port, filePath: ideWindow.workspaceFolders[0] }),
    });
  }

  function isNearBottom() {
    const el = scrollRef.current;
    if (!el) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  async function toggleRead() {
    const nowRead = !isRead;
    setIsRead(nowRead);
    await fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        nowRead ? { slug: readStateKey } : { slug: readStateKey, unread: true }
      ),
    });
    onReadStateChange?.();
  }

  const loadTranscript = useCallback((change?: ChangeEvent) => {
    if (change && change.sessionId !== id) return;
    const wasNearBottom = isNearBottom();
    Promise.all([
      fetch(`/api/projects/${slug}/sessions/${id}`),
      fetch(`/api/projects/${slug}/sessions/${id}/stats`),
    ]).then(([transcriptRes, statsRes]) => {
      if (!transcriptRes.ok) {
        setNotFound(true);
        return;
      }
      return Promise.all([transcriptRes.json(), statsRes.ok ? statsRes.json() : null]).then(
        ([transcript, freshStats]) => {
          setNotFound(false);
          setMessages(transcript.messages ?? []);
          if (freshStats && !freshStats.error) setStats(freshStats);
          if (wasNearBottom) {
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          }
        }
      );
    });
  }, [slug, id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setMessages([]);
    setTitle(null);
    setDisplayPath(null);
    setStats(null);
    pendingScrollRef.current = true;

    fetch(`/api/projects/${slug}/sessions/${id}/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (!cancelled && s && !s.error) setStats(s); });

    setIdeWindow(null);

    fetch(`/api/projects/${slug}/sessions/${id}`).then((transcriptRes) => {
      if (!transcriptRes.ok) {
        if (cancelled) return;
        setNotFound(true);
        setLoading(false);
        return;
      }
      return Promise.all([
        transcriptRes.json(),
        fetch(`/api/projects/${slug}/sessions`).then((r) => (r.ok ? r.json() : [])),
        fetch("/api/read-state").then((r) => r.json()),
        fetch("/api/settings").then((r) => r.json()),
        fetch("/api/projects").then((r) => r.json()),
        fetch("/api/ide-windows").then((r) => r.json()),
      ]).then(([transcript, sessions, readState, settings, projects, ideWindows]) => {
        if (cancelled) return;
        setIdeWindow(
          Array.isArray(ideWindows)
            ? findIdeWindowForSlug(decodeURIComponent(slug), ideWindows) ?? null
            : null
        );
        setMessages(transcript.messages ?? []);
        const session = Array.isArray(sessions)
          ? sessions.find((s: { id: string }) => s.id === id)
          : null;
        setTitle(session?.title ?? null);
        const project = Array.isArray(projects)
          ? projects.find((p: { slug: string }) => p.slug === decodeURIComponent(slug))
          : null;
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
          onReadStateChange?.();
        }

        setLoading(false);
      });
    });

    return () => { cancelled = true; };
  }, [slug, id, readStateKey]);

  // Scroll to bottom once the freshly opened transcript is actually in the DOM.
  useEffect(() => {
    if (!pendingScrollRef.current || messages.length === 0) return;
    pendingScrollRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }, [messages]);

  useEffect(() => {
    setStickyMsg(null);
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const scrollRect = el.getBoundingClientRect();
      let candidate: string | null = null;
      const entries = Array.from(userMsgRefs.current.entries()).sort(([a], [b]) => a - b);
      for (const [, ref] of entries) {
        if (ref.getBoundingClientRect().bottom < scrollRect.top + 4) {
          candidate = ref.dataset.text ?? null;
        }
      }
      setStickyMsg(prev => {
        if (candidate === prev) return prev;
        if (candidate) {
          if (pulseTimer.current) clearTimeout(pulseTimer.current);
          setStickyPulse(true);
          pulseTimer.current = setTimeout(() => setStickyPulse(false), 500);
        }
        return candidate;
      });
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [messages]);

  useEffect(() => {
    function poll() {
      fetch("/api/monitor-active-sessions")
        .then((r) => r.json())
        .then((ids: string[]) => setMonitorActive(ids.includes(id)))
        .catch(() => {});
    }
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [id]);

  async function handleChatSend() {
    if (!chatMessage.trim() || chatLoading) return;
    setChatLoading(true);
    setChatError(null);
    setChatSent(false);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/send-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatMessage }),
      });
      const data = await res.json();
      if (res.ok) {
        setChatMessage("");
        setChatSent(true);
        setTimeout(() => setChatSent(false), 2000);
        chatInputRef.current?.focus();
      } else {
        setChatError(data.error ?? "Failed to send.");
      }
    } catch {
      setChatError("Network error.");
    } finally {
      setChatLoading(false);
    }
  }

  useDataRefresh(loadTranscript);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sticky header within the panel */}
      <div className="shrink-0 bg-zinc-950 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 className="text-base font-semibold text-white truncate">{title}</h2>
            ) : (
              !loading && !notFound && <h2 className="text-base font-semibold text-zinc-500 italic truncate">Untitled</h2>
            )}
            {!loading && notFound && (
              <h2 className="text-base font-semibold text-zinc-500 italic truncate">Session not found</h2>
            )}
            {displayPath && (
              <div className="flex items-center gap-1 mt-0.5 min-w-0">
                <Link
                  href={`/projects/${encodeURIComponent(slug)}?highlight=${id}`}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors truncate"
                >
                  {displayPath}
                </Link>
                <button
                  onClick={copyPath}
                  title="Copy path"
                  className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-mono text-zinc-600 truncate">{id}</span>
              <button
                onClick={copyId}
                title="Copy session ID"
                className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {ideWindow && (
              <button
                onClick={focusIde}
                title={`Open in ${ideWindow.ideName}`}
                className="text-xs font-mono px-2 py-1.5 rounded-md bg-blue-950 text-blue-400 hover:bg-blue-900 hover:text-blue-300 transition-colors"
              >
                VS
              </button>
            )}
            {!loading && !notFound && (
              <button
                onClick={toggleRead}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  isRead
                    ? "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    : "border-blue-700 text-blue-400 hover:border-blue-500 hover:text-blue-200"
                }`}
              >
                {isRead ? "Mark as unread" : "Mark as read"}
              </button>
            )}
          </div>
        </div>
        {stats && <StatsBar stats={stats} />}
      </div>

      {/* Sticky user message strip */}
      <div className={`shrink-0 overflow-hidden border-b transition-all duration-200 group/sticky ${stickyMsg ? "max-h-32 border-zinc-800" : "max-h-0 border-transparent"}`}>
        <div className="flex flex-row-reverse items-start gap-3 px-4 py-2.5">
          <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-blue-700 text-white mt-0.5">
            U
          </div>
          <div className={`max-w-[85%] min-w-0 rounded-xl px-4 py-2.5 text-sm bg-blue-900 text-zinc-100 transition-shadow duration-300 truncate group-hover/sticky:truncate-none group-hover/sticky:whitespace-normal group-hover/sticky:overflow-visible ${stickyPulse ? "shadow-[0_2px_16px_rgba(96,165,250,0.25)]" : ""}`}>
            {stickyMsg}
          </div>
        </div>
      </div>

      {/* Scrollable messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        {loading ? (
          <TranscriptSkeleton />
        ) : notFound ? (
          <p className="text-zinc-500 text-sm">Session not found — it may have been deleted or moved.</p>
        ) : messages.length === 0 ? (
          <p className="text-zinc-500 text-sm">No messages in this session.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((msg, i) => (
              <div
                key={msg.uuid ?? i}
                ref={msg.type === "user" ? (el) => {
                  if (el) { el.dataset.text = msg.text.slice(0, 200); userMsgRefs.current.set(i, el); }
                  else userMsgRefs.current.delete(i);
                } : undefined}
                className={`flex gap-3 ${msg.type === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  msg.type === "user" ? "bg-blue-700 text-white" : "bg-zinc-700 text-zinc-300"
                }`}>
                  {msg.type === "user" ? "U" : "C"}
                </div>
                <div className={`max-w-[85%] min-w-0 rounded-xl px-4 py-3 text-sm break-words ${
                  msg.type === "user" ? "bg-blue-900 text-zinc-100" : "bg-zinc-800 text-zinc-200"
                }`}>
                  {msg.type === "user" ? (
                    <div className="prose prose-sm prose-invert max-w-none
                      prose-p:my-1 prose-code:bg-blue-950 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-200 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                      prose-pre:bg-blue-950 prose-pre:border prose-pre:border-blue-900 prose-pre:rounded-lg prose-pre:p-3 prose-pre:overflow-x-auto
                      prose-headings:text-zinc-100 prose-strong:text-zinc-100">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{msg.text}</ReactMarkdown>
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
                        components={markdownComponents}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  )}
                  {msg.timestamp && (
                    <div className="mt-2 text-xs text-zinc-500">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
          {monitorActive ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                <span className="text-xs text-zinc-500">Monitor active — messages go directly to this session</span>
              </div>
              <div className="flex gap-2">
                <textarea
                  ref={chatInputRef}
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleChatSend(); }}
                  placeholder="Send a message to this session… (Ctrl+Enter)"
                  rows={2}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleChatSend}
                  disabled={chatLoading || !chatMessage.trim()}
                  className="shrink-0 self-end px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {chatLoading ? "…" : "Send"}
                </button>
              </div>
              {chatSent && <p className="text-xs text-green-400">Sent</p>}
              {chatError && <p className="text-xs text-red-400">{chatError}</p>}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-zinc-500">No monitor running on this session</span>
              <button
                onClick={() => setShowSetupModal(true)}
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
              >
                Setup monitor →
              </button>
            </div>
          )}
        </div>

      {showSetupModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowSetupModal(false)}>
          <div className="bg-zinc-900 rounded-xl border border-zinc-700 p-6 w-full max-w-lg mx-4 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-200">Setup monitor for this session</h3>
            <p className="text-xs text-zinc-500">Paste this Monitor tool call into your Claude Code session:</p>
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 flex items-start gap-2">
              <pre className="text-xs text-zinc-300 font-mono flex-1 leading-relaxed overflow-x-auto whitespace-pre">
                {buildMonitorToolCall(id)}
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildMonitorToolCall(id));
                  setToast("Copied to clipboard");
                  setTimeout(() => setToast(null), 2000);
                }}
                className="shrink-0 text-xs px-2 py-1 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setShowSetupModal(false)} className="text-xs px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-700 text-zinc-100 text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}
