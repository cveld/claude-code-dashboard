"use client";

import { useEffect, useState } from "react";
import { DashboardNav } from "@/app/components/DashboardNav";
import { ProjectInfo } from "@/app/lib/dashboard";

interface Settings {
  autoMarkAsRead: boolean;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ]).then(([s, p]) => {
      setSettings(s);
      setProjects(p);
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
    </div>
  );
}
