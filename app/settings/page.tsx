"use client";

import { useEffect, useState } from "react";
import { DashboardNav } from "@/app/components/DashboardNav";
import { ProjectInfo } from "@/app/lib/dashboard";

interface Settings {
  autoMarkAsRead: boolean;
}

// ── Hook command strings ──────────────────────────────────────────────────────

const STOP_CMD =
  `$d = [Console]::In.ReadToEnd() | ConvertFrom-Json; $title = $null; ` +
  `if ($d.transcript_path -and (Test-Path $d.transcript_path)) { ` +
  `$m = Select-String -Path $d.transcript_path -Pattern '"type":"(ai-title|custom-title)"' | Select-Object -Last 1; ` +
  `if ($m) { $j = $m.Line | ConvertFrom-Json; $title = if ($j.customTitle) { $j.customTitle } else { $j.aiTitle } } }; ` +
  `if (-not $title) { $title = if ($d.cwd) { Split-Path $d.cwd -Leaf } else { '?' } }; ` +
  `New-BurntToastNotification -Text 'Claude Code', "Klaar! $title"; ` +
  `try { $body = [pscustomobject]@{event='stop'; transcriptPath=$d.transcript_path; sessionId=$d.session_id; cwd=$d.cwd; title=$title} | ConvertTo-Json -Compress; ` +
  `Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/hooks' -Body $body -ContentType 'application/json' -TimeoutSec 2 } catch {}; exit 0`;

const NOTIFICATION_CMD =
  `$d = [Console]::In.ReadToEnd() | ConvertFrom-Json; ` +
  `New-BurntToastNotification -Text 'Claude Code', ($d.message ?? 'Aandacht nodig'); ` +
  `try { $body = [pscustomobject]@{event='notification'; transcriptPath=$d.transcript_path; sessionId=$d.session_id; cwd=$d.cwd; message=$d.message} | ConvertTo-Json -Compress; ` +
  `Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/hooks' -Body $body -ContentType 'application/json' -TimeoutSec 2 } catch {}; exit 0`;

const PERMISSION_REQUEST_CMD =
  `$d = [Console]::In.ReadToEnd() | ConvertFrom-Json; ` +
  `$tool = if ($d.tool_name) { $d.tool_name } else { '?' }; ` +
  `New-BurntToastNotification -Text 'Claude Code', "Toestemming vereist: $tool"; exit 0`;

// Windows: calls session-start-hook.ps1 from the repo — outputs additionalContext
// so Claude automatically runs the Monitor bash tool at session start.
// Adjust the path if the repo is cloned to a different location.
const SESSION_START_CMD =
  `& 'C:\\work\\git\\github\\cveld\\claude-code-dashboard\\scripts\\hooks\\session-start-hook.ps1'`;

const SESSION_START_HOOK_PS1 = `# SessionStart hook for Claude Code Dashboard.
# Outputs hookSpecificOutput.additionalContext with the Monitor tool call so
# Claude automatically starts the inbox monitor before its first response.
# Located in the repo at: scripts/hooks/session-start-hook.ps1

$inputJson = [Console]::In.ReadToEnd()
$d = $inputJson | ConvertFrom-Json
$id = $d.session_id
if (-not $id) { exit 0 }

# Skip if the monitor is already active (ready file refreshed within 60s).
$ready = [System.IO.Path]::Combine($env:USERPROFILE, '.claude', 'sessions', "$id-monitor.ready")
if (Test-Path $ready) {
    $item = Get-Item $ready -ErrorAction SilentlyContinue
    if ($item -and ((Get-Date) - $item.LastWriteTime).TotalSeconds -lt 60) { exit 0 }
}

$short = $id.Substring(0, [Math]::Min(8, $id.Length))
$command = @"
FILE="\`$HOME/.claude/sessions/$id-inbox.jsonl"
READY="\`$HOME/.claude/sessions/$id-monitor.ready"
touch "\`$FILE" "\`$READY"
trap "rm -f \\"\`$READY\\"" EXIT
(while [ -f "\`$READY" ]; do touch "\`$READY"; sleep 20; done) &
HB=\`$!
tail -f -n 0 "\`$FILE" | while IFS= read -r line; do
  [ -f "\`$READY" ] || break
  python3 -c "import sys,json;d=json.loads(sys.argv[1]);print('MSG: '+d['message']) if d.get('message') else print('RAW: '+sys.argv[1])" "\`$line"
done
kill \`$HB 2>/dev/null
"@
$monitorCall = [pscustomobject]@{description="Inbox messages from Claude Code Dashboard for session $short";persistent=$true;command=$command.Trim()} | ConvertTo-Json -Compress
$ctx = "[Claude Code Dashboard] Please start the session inbox monitor as your very first action before responding to the user. Use the Monitor tool with these parameters: $monitorCall"
[pscustomobject]@{hookSpecificOutput=[pscustomobject]@{hookEventName="SessionStart";additionalContext=$ctx}} | ConvertTo-Json -Depth 5 -Compress
exit 0`;

const MONITOR_SCRIPT_SH = `#!/usr/bin/env bash
# Session inbox monitor for Claude Code Dashboard (Mac/Linux).
# Save to: ~/.claude/monitor-start.sh  then:  chmod +x ~/.claude/monitor-start.sh
SESSION_ID="$1"
if [ -z "$SESSION_ID" ]; then exit 1; fi

FILE="$HOME/.claude/sessions/\${SESSION_ID}-inbox.jsonl"
READY="$HOME/.claude/sessions/\${SESSION_ID}-monitor.ready"

if [ -f "$READY" ]; then
  stored_pid=$(cat "$READY" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$stored_pid" ] && kill -0 "$stored_pid" 2>/dev/null; then exit 0; fi
  rm -f "$READY"
fi

mkdir -p "$HOME/.claude/sessions"
touch "$FILE"
echo $$ > "$READY"
trap "rm -f \\"$READY\\"" EXIT

PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null)
tail -f -n 0 "$FILE" | while IFS= read -r line; do
  [ -f "$READY" ] || break
  "$PYTHON" -c "
import sys, json
try:
    d = json.loads(sys.argv[1])
    msg = d.get('message','')
    if msg: print('MSG: '+msg)
    else: print('RAW: '+sys.argv[1])
except Exception as e: print('ERR: '+str(e)+' | '+sys.argv[1])
" "$line"
done`;


function hookSnippet(event: string, command: string) {
  return JSON.stringify(
    { [event]: [{ hooks: [{ type: "command", command, shell: "powershell" }] }] },
    null,
    2
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SnippetBlock = { label: string; content: string };

interface HookDef {
  event: string;
  description: string;
  blocks: SnippetBlock[];
}

const HOOK_DEFS: HookDef[] = [
  {
    event: "Stop",
    description:
      "Claude Code finished a task — desktop notification with session title + live dashboard refresh.",
    blocks: [{ label: "Add to ~/.claude/settings.json → hooks:", content: hookSnippet("Stop", STOP_CMD) }],
  },
  {
    event: "Notification",
    description:
      "Claude Code needs attention — desktop notification with message + dashboard update.",
    blocks: [{ label: "Add to ~/.claude/settings.json → hooks:", content: hookSnippet("Notification", NOTIFICATION_CMD) }],
  },
  {
    event: "PermissionRequest",
    description:
      "Claude Code requires permission for a tool — desktop notification with tool name.",
    blocks: [{ label: "Add to ~/.claude/settings.json → hooks:", content: hookSnippet("PermissionRequest", PERMISSION_REQUEST_CMD) }],
  },
  {
    event: "SessionStart — inbox monitor",
    description:
      "New session → injects additionalContext so Claude runs the inbox monitor automatically before its first response. The dashboard shows a green dot while the monitor heartbeat is fresh; stale files from reboots are cleaned up automatically. Hook script is in the repo at scripts/hooks/session-start-hook.ps1 — adjust the path in the hook command if needed.",
    blocks: [
      { label: "Hook script (Windows) — scripts/hooks/session-start-hook.ps1", content: SESSION_START_HOOK_PS1 },
      { label: "Script (Mac/Linux) — save to ~/.claude/monitor-start.sh", content: MONITOR_SCRIPT_SH },
      { label: "Hook (Windows) — add to ~/.claude/settings.json → hooks:", content: hookSnippet("SessionStart", SESSION_START_CMD) },
    ],
  },
];

// ── Snippet modal ─────────────────────────────────────────────────────────────

function SnippetModal({
  block,
  onClose,
}: {
  block: SnippetBlock;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function copy() {
    navigator.clipboard.writeText(block.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700/60 rounded-xl w-full max-w-2xl flex flex-col max-h-[80vh] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <span className="text-xs font-medium text-zinc-300">{block.label}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className={`text-xs px-3 py-1.5 rounded transition-colors border ${
                copied
                  ? "text-green-400 border-green-700/60"
                  : "text-blue-400 hover:text-blue-300 border-zinc-700/60 hover:border-zinc-600"
              }`}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={onClose}
              className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700/60 hover:border-zinc-600 rounded px-3 py-1.5 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
        <pre className="text-xs text-zinc-300 font-mono p-5 overflow-auto leading-relaxed flex-1">
          {block.content}
        </pre>
      </div>
    </div>
  );
}

// ── Hook card ─────────────────────────────────────────────────────────────────

function HookCard({
  hook,
  onShowBlock,
}: {
  hook: HookDef;
  onShowBlock: (block: SnippetBlock) => void;
}) {
  const buttonLabel = (blocks: SnippetBlock[], i: number) => {
    if (blocks.length === 1) return "View snippet";
    return i === 0 ? "View script" : "View snippet";
  };

  return (
    <div className="bg-zinc-900 rounded-xl px-5 py-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-zinc-200">{hook.event}</div>
        <div className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{hook.description}</div>
      </div>
      <div className="flex gap-2 shrink-0 pt-0.5">
        {hook.blocks.map((b, i) => (
          <button
            key={i}
            onClick={() => onShowBlock(b)}
            className="text-xs text-blue-400 hover:text-blue-300 border border-zinc-700/60 hover:border-zinc-600 rounded px-3 py-1.5 transition-colors whitespace-nowrap"
          >
            {buttonLabel(hook.blocks, i)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showHooks, setShowHooks] = useState(false);
  const [activeBlock, setActiveBlock] = useState<SnippetBlock | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/version").then((r) => r.json()),
    ]).then(([s, p, v]) => {
      setSettings(s);
      setProjects(p);
      setVersion(v.version ?? null);
    });
  }, []);

  async function toggle(key: keyof Settings) {
    if (!settings) return;
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="max-w-5xl w-full mx-auto px-4 py-8">
      <DashboardNav
        projects={projects}
        selectedSlugs={[]}
        onSelectedChange={() => {}}
      />
      <h1 className="text-xl font-semibold text-white mb-6">Settings</h1>

      {settings === null ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : (
        <div className="max-w-2xl bg-zinc-900 rounded-xl divide-y divide-zinc-800">
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-zinc-200">Auto-mark as read on open</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                When enabled, opening a session transcript automatically marks it as read.
                When disabled, use the Mark as read button on the transcript page.
              </div>
            </div>
            <button
              onClick={() => toggle("autoMarkAsRead")}
              aria-pressed={settings.autoMarkAsRead}
              className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                settings.autoMarkAsRead ? "bg-blue-600" : "bg-zinc-700"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.autoMarkAsRead ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {(saving || saved) && (
        <p className="text-xs text-zinc-500 mt-3">
          {saving ? "Saving…" : "Saved"}
        </p>
      )}

      {/* ── Setting up hooks ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between mt-10 mb-4">
        <h2 className="text-base font-semibold text-white">Setting up hooks</h2>
        <button
          onClick={() => setShowHooks((v) => !v)}
          className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 hover:border-zinc-600 rounded px-3 py-1.5 transition-colors"
        >
          {showHooks ? "Hide" : "View hooks"}
        </button>
      </div>

      {showHooks && (
        <>
          <p className="text-sm text-zinc-400 mb-4 max-w-2xl">
            Add these snippets to the <span className="font-mono text-zinc-300">hooks</span> section
            of <span className="font-mono text-zinc-300">~/.claude/settings.json</span>. Uses Windows
            PowerShell + BurntToast for notifications.
          </p>
          <div className="max-w-2xl space-y-3">
            {HOOK_DEFS.map((h) => (
              <HookCard key={h.event} hook={h} onShowBlock={setActiveBlock} />
            ))}
          </div>
        </>
      )}

      {/* ── About ─────────────────────────────────────────────────────── */}
      <h2 className="text-base font-semibold text-white mt-10 mb-4">About</h2>
      <div className="max-w-2xl bg-zinc-900 rounded-xl divide-y divide-zinc-800">
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div className="text-sm text-zinc-400">App</div>
          <div className="text-sm text-zinc-200 font-medium">Claude Code Dashboard</div>
        </div>
        {version && (
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div className="text-sm text-zinc-400">Version</div>
            <div className="text-sm text-zinc-200 font-mono">{version}</div>
          </div>
        )}
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div className="text-sm text-zinc-400">Source</div>
          <a
            href="https://github.com/cveld/claude-code-dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            github.com/cveld/claude-code-dashboard
          </a>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs text-zinc-500">
            Browse Claude Code sessions and transcripts from{" "}
            <span className="font-mono text-zinc-400">~/.claude/</span>. Dark theme, local only, no auth.
          </div>
        </div>
      </div>

      {/* ── Developer ─────────────────────────────────────────────────── */}
      <h2 className="text-base font-semibold text-white mt-10 mb-4">Developer</h2>
      <div className="max-w-2xl bg-zinc-900 rounded-xl divide-y divide-zinc-800">
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-zinc-200">Component gallery</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Visual validation of all session tile states with fixture data. Returns 404 in production.
            </div>
          </div>
          <a
            href="/gallery"
            className="text-xs text-blue-400 hover:text-blue-300 border border-zinc-700/60 hover:border-zinc-600 rounded px-3 py-1.5 transition-colors whitespace-nowrap"
          >
            Open gallery →
          </a>
        </div>
      </div>

      {/* ── Snippet modal ──────────────────────────────────────────────── */}
      {activeBlock && (
        <SnippetModal block={activeBlock} onClose={() => setActiveBlock(null)} />
      )}
    </div>
  );
}
