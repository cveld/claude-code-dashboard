"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TokenComponents } from "@/app/lib/dashboard";

// Stable color per model regardless of sort order, so the same model always
// gets the same dot color across tiles/sessions.
const MODEL_DOT_COLORS = [
  "bg-purple-400",
  "bg-blue-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-pink-400",
  "bg-cyan-400",
];

function colorForModel(model: string): string {
  let hash = 0;
  for (let i = 0; i < model.length; i++) hash = (hash * 31 + model.charCodeAt(i)) | 0;
  return MODEL_DOT_COLORS[Math.abs(hash) % MODEL_DOT_COLORS.length];
}

// "claude-opus-4-8" -> "Opus 4.8", "claude-sonnet-5" -> "Sonnet 5",
// "claude-haiku-4-5-20251001" -> "Haiku 4.5" (trailing date dropped)
export function shortModelName(model: string): string {
  const m = model.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/i);
  if (!m) return model;
  const [, family, major, minor] = m;
  const version = minor ? `${major}.${minor}` : major;
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function componentsTotal(c: TokenComponents): number {
  return c.input + c.cacheCreation + c.cacheRead + c.output;
}

type Position = { top: number; left: number; right: number };

// Rendered into a portal (not inline) so it can escape ancestors that clip
// overflow for their own reasons (e.g. a session tile's `overflow-hidden`
// used to keep its rounded corners crisp against a full-bleed progress bar).
export function BurnedTokensTooltip({
  children,
  input,
  cacheCreation,
  cacheRead,
  output,
  perModel,
  align = "right",
}: {
  children: ReactNode;
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  perModel: Record<string, TokenComponents>;
  align?: "left" | "right";
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState(false);

  function computePos(): Position | null {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      top: rect.bottom + 8,
      left: rect.left,
      right: window.innerWidth - rect.right,
    };
  }
  function show() {
    setPos(computePos());
  }
  function hide() {
    if (!pinned) setPos(null);
  }
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setPinned((wasPinned) => {
      const nowPinned = !wasPinned;
      setPos(nowPinned ? computePos() : null);
      if (!nowPinned) setCopied(false);
      return nowPinned;
    });
  }

  // Clicking anywhere outside the trigger unpins — otherwise a pinned
  // tooltip would stay open forever since it no longer closes on mouse-leave.
  useEffect(() => {
    if (!pinned) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target)) return;
      setPinned(false);
      setPos(null);
      setCopied(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pinned]);

  const total = input + cacheCreation + cacheRead + output;
  const models = Object.entries(perModel)
    .filter(([, c]) => componentsTotal(c) > 0)
    .sort((a, b) => componentsTotal(b[1]) - componentsTotal(a[1]));

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const lines = [
      "Tokens billed across all turns",
      `Input (fresh): ${input.toLocaleString()}`,
      `Cache write: ${cacheCreation.toLocaleString()}`,
      `Cache read: ${cacheRead.toLocaleString()}`,
      `Output: ${output.toLocaleString()}`,
      `Total: ${total.toLocaleString()}`,
    ];
    if (models.length > 0) {
      lines.push("", models.length > 1 ? "By model:" : "Model:");
      for (const [model, c] of models) {
        const t = componentsTotal(c);
        const pct = total > 0 ? Math.round((t / total) * 100) : 0;
        lines.push(
          models.length > 1
            ? `${shortModelName(model)}: ${t.toLocaleString()} (${pct}%)`
            : `${shortModelName(model)}: ${t.toLocaleString()}`
        );
      }
    }
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span
      ref={triggerRef}
      className="inline-flex items-center cursor-pointer"
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={handleClick}
    >
      {children}
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`fixed w-max min-w-[190px] rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs shadow-lg z-50 ${
              pinned ? "pointer-events-auto" : "pointer-events-none"
            }`}
            style={{ top: pos.top, ...(align === "right" ? { right: pos.right } : { left: pos.left }) }}
          >
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-zinc-400 font-medium">Tokens billed across all turns</span>
              {pinned && (
                <button
                  onClick={handleCopy}
                  title={copied ? "Copied" : "Copy to clipboard"}
                  className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  {copied ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div className="space-y-0.5 tabular-nums">
              <Row label="Input (fresh)" value={input} />
              <Row label="Cache write" value={cacheCreation} />
              <Row label="Cache read" value={cacheRead} />
              <Row label="Output" value={output} />
            </div>
            {models.length > 0 && (
              <>
                <div className="border-t border-zinc-700 my-1.5" />
                <div className="text-zinc-400 font-medium mb-1">{models.length > 1 ? "By model" : "Model"}</div>
                <div className="space-y-0.5 tabular-nums">
                  {models.map(([model, c]) => {
                    const t = componentsTotal(c);
                    const pct = total > 0 ? Math.round((t / total) * 100) : 0;
                    return (
                      <div key={model} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-zinc-300">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorForModel(model)}`} />
                          {shortModelName(model)}
                        </span>
                        <span className="text-zinc-300">
                          {models.length > 1 ? `${fmtTokens(t)} (${pct}%)` : fmtTokens(t)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-300">{value.toLocaleString()}</span>
    </div>
  );
}
