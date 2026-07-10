export function ListSkeleton({ count = 6, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className={compact ? "flex flex-col gap-0.5" : "flex flex-col gap-1"}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center gap-4 rounded-lg bg-zinc-900 animate-pulse ${
            compact ? "px-3 py-2" : "px-4 py-3"
          }`}
        >
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className={`h-3.5 bg-zinc-800 rounded ${compact ? "w-1/2" : "w-1/3"}`} />
            <div className="h-2.5 bg-zinc-800 rounded w-1/4" />
          </div>
          {!compact && <div className="h-3 w-16 bg-zinc-800 rounded shrink-0" />}
        </div>
      ))}
    </div>
  );
}
