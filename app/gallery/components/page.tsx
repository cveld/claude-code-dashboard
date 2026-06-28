import { notFound } from "next/navigation";

if (process.env.NODE_ENV === "production") {}

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

function HookBadge({ type, read }: { type: "stop" | "notification"; read?: boolean }) {
  if (type === "stop") {
    return (
      <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${read ? "bg-zinc-500/20 text-zinc-500" : "bg-green-500/20 text-green-400"}`}>
        <IconCheck />
      </span>
    );
  }
  return (
    <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
      <IconBell />
    </span>
  );
}

function contextBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-orange-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-blue-500";
}

interface TileFixture {
  label: string;
  title: string;
  path: string;
  unread: boolean;
  hook: "stop" | "notification" | null;
  ctxPct: number | null;
  monitorActive: boolean;
}

const STATUS_FIXTURES: TileFixture[] = [
  { label: "Unread", title: "Fix authentication bug in API", path: "c:/work/project", unread: true, hook: null, ctxPct: null, monitorActive: false },
  { label: "Read", title: "Add dark mode support", path: "c:/work/project", unread: false, hook: null, ctxPct: null, monitorActive: false },
  { label: "Unread + completed", title: "Refactor database layer", path: "c:/work/project", unread: true, hook: "stop", ctxPct: null, monitorActive: false },
  { label: "Read + completed", title: "Update dependencies to latest", path: "c:/work/project", unread: false, hook: "stop", ctxPct: null, monitorActive: false },
  { label: "Notification", title: "Deploy to production", path: "c:/work/project", unread: false, hook: "notification", ctxPct: null, monitorActive: false },
];

const TILE_FIXTURES: TileFixture[] = [
  { label: "Monitor active", title: "Live debugging session", path: "c:/work/project", unread: false, hook: null, ctxPct: null, monitorActive: true },
  { label: "Context low (30%)", title: "Write unit tests for auth module", path: "c:/work/project", unread: false, hook: null, ctxPct: 30, monitorActive: false },
  { label: "Context high (80%)", title: "Implement OAuth2 integration", path: "c:/work/project", unread: false, hook: null, ctxPct: 80, monitorActive: false },
  { label: "Context critical (95%)", title: "Major refactor of core services", path: "c:/work/project", unread: false, hook: null, ctxPct: 95, monitorActive: false },
  { label: "Long title", title: "This is a very long session title that should be truncated because it exceeds the available width of the tile container in the session list", path: "c:/work/very/long/project/path/that/also/gets/truncated/in/display", unread: true, hook: null, ctxPct: 45, monitorActive: false },
];

function GalleryTile({ fixture }: { fixture: TileFixture }) {
  const { label, title, path, unread, hook, ctxPct, monitorActive } = fixture;
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-1 font-medium">{label}</div>
      <div className="rounded-lg bg-zinc-900 overflow-hidden">
        <div className="flex items-start gap-4 px-4 py-3 group">
          {hook ? (
            <HookBadge type={hook} read={!unread} />
          ) : unread ? (
            <span title="Unread" className="w-2 h-2 rounded-full bg-blue-400 shrink-0 mt-1" />
          ) : (
            <span className="w-2 h-2 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-200 truncate">{title}</div>
            <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
              <span className="text-xs text-zinc-500 truncate font-mono">{path}</span>
            </div>
          </div>
          <div className="flex items-start gap-1 shrink-0">
            <div className="text-xs px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 whitespace-nowrap mt-0.5 flex items-center gap-1">
              {monitorActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />}
              Send →
            </div>
            <div className="text-xs px-2 py-0.5 rounded border border-zinc-700 text-zinc-400 whitespace-nowrap mt-0.5">
              {unread ? "Mark read" : "Mark unread"}
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-600">2m ago</div>
              <div className="text-xs text-zinc-600 mt-0.5">42 msgs</div>
              {ctxPct !== null && (
                <div className={`text-xs mt-0.5 tabular-nums ${ctxPct >= 75 ? "text-orange-500" : "text-zinc-600"}`}>{ctxPct}% ctx</div>
              )}
            </div>
            <div className="p-1 text-zinc-600">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6 4l8 6-8 6V4z" />
              </svg>
            </div>
          </div>
        </div>
        {ctxPct !== null && (
          <div className="h-0.5 bg-zinc-800">
            <div className={`h-full ${contextBarColor(ctxPct)}`} style={{ width: `${ctxPct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function GalleryComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="px-4 py-6 space-y-10">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Status indicators</h2>
        <div className="space-y-3">
          {STATUS_FIXTURES.map((f) => (
            <GalleryTile key={f.label} fixture={f} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3">Session tiles</h2>
        <div className="space-y-3">
          {TILE_FIXTURES.map((f) => (
            <GalleryTile key={f.label} fixture={f} />
          ))}
        </div>
      </section>
    </div>
  );
}
