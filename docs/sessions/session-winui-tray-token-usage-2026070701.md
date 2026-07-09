# Windows tray app for continuous Claude token-usage visibility (WinUI 3)

**Status:** Open
**Created:** 2026-07-07

## Goal

Build a Windows system-tray app (WinUI 3) that continuously shows the user's Claude
usage-quota utilization (5h / 7d / 7d-sonnet rate-limit windows), so it's visible without
opening the dashboard.

## Decisions

- **Location**: new subfolder in this repo, `windows-tray/ClaudeTokenTray/` — a standalone
  .NET/WinUI 3 project living alongside the Next.js app, not a separate repo.
- **Framework**: WinUI 3 (Windows App SDK), chosen over WinForms/Tauri for being
  Microsoft's forward-looking native UI stack. Note: WinUI 3 has no first-party tray-icon
  API — needs the community `H.NotifyIcon.WinUI` package.
- **Data source**: the tray app reads `~/.claude/.credentials.json` and calls
  `https://api.anthropic.com/api/oauth/usage` directly from C#, mirroring the existing
  logic in [app/api/token-usage/route.ts](../../app/api/token-usage/route.ts) (Bearer
  token + `anthropic-beta: oauth-2025-04-20` header, parsing `five_hour` / `seven_day` /
  `seven_day_sonnet` → `{ utilization, resets_at }`). This makes the tray app work
  standalone, without requiring `npm run dev` to be running.
- **Display**: the tray icon's primary number is the **5-hour window** utilization
  (redrawn as text on the icon, color-coded by threshold). The tooltip/context menu shows
  the full breakdown (5h / 7d / 7d-sonnet with reset times).

## Environment already verified (2026-07-07)

- .NET SDKs installed: 8.0.422, 9.0.205/9.0.315, 10.0.100/10.0.203/10.0.301.
- Visual Studio Enterprise 2026 (18.5.2) is installed.
- No WinUI 3 templates present by default; official template package
  `Microsoft.WindowsAppSDK.WinUI.CSharp.Templates` is available on NuGet:
  `dotnet new install Microsoft.WindowsAppSDK.WinUI.CSharp.Templates`.

## Implementation approach

- Scaffold a WinUI 3 "Blank App" project under `windows-tray/ClaudeTokenTray/`, targeting
  a stable Windows App SDK TFM (e.g. `net8.0-windows10.0.19041.0`).
- Add `H.NotifyIcon.WinUI` for the tray icon control, plus `System.Drawing.Common` for
  rendering the percentage onto a dynamic tray icon bitmap.
- `TokenUsageClient`: C# port of the credential-read + usage-fetch logic from
  `app/api/token-usage/route.ts`.
- `TrayIconService`: owns the `TaskbarIcon`, builds the context menu (Refresh now, Start
  with Windows toggle via `HKCU\...\Run`, Exit), redraws the icon on each poll.
- Poll every 5 minutes (matches the existing route's `CACHE_TTL_MS`), plus a manual
  "Refresh now" menu action.
- No visible main window at startup — app launches straight to tray.
- Error/edge states: missing credentials → greyed icon + "not logged in" tooltip; API
  error → keep last good value, tooltip flags it as stale.
- Out of scope unless requested later: MSIX packaging/store distribution, code signing,
  multi-account support.

## Related files

- [app/api/token-usage/route.ts](../../app/api/token-usage/route.ts) — existing Next.js
  logic to port to C# (credential read + Anthropic usage API call + parsing).
