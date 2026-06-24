"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { TranscriptPanel } from "@/app/components/TranscriptPanel";
import { TokenUsageBadge } from "@/app/components/TokenUsageBadge";

function SessionPageInner() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const searchParams = useSearchParams();
  const backHref = searchParams.get("from") === "sessions" ? "/sessions" : `/projects/${slug}`;

  return (
    <div className="flex flex-col h-screen">
      <div className="shrink-0 bg-zinc-950 border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <Link href={backHref} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          ← Back
        </Link>
        <TokenUsageBadge />
      </div>
      <div className="flex-1 overflow-hidden">
        <TranscriptPanel slug={slug} id={id} />
      </div>
    </div>
  );
}

export default function SessionPage() {
  return (
    <Suspense fallback={null}>
      <SessionPageInner />
    </Suspense>
  );
}
