# Windows tray app (windows-tray/ClaudeTokenTray)

Standalone .NET/WinUI 3 project living alongside the Next.js app, not published or referenced
by it. Shows the user's Claude usage-quota utilization (5h / 7d / 7d-sonnet) continuously in
the system tray, independent of `npm run dev` running.

## Structure

| File | Contents |
|---|---|
| `App.xaml` | Defines the `TaskbarIcon` as an `x:Key="TrayIcon"` resource (not in any window's visual tree — this app never shows a window), plus `XamlUICommand` resources (`RefreshCommand`, `IconStyleNumberCommand`, `IconStyleBarsCommand`, `StartWithWindowsCommand`, `ExitCommand`) wired to the tray's context menu. |
| `App.xaml.cs` | `OnLaunched` fetches `TrayIcon` from `Resources` and hands it to `TrayIconService`. No `Window` is ever created. |
| `TokenUsage.cs` / `TokenUsageClient.cs` | C# port of `app/api/token-usage/route.ts`: reads `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`, calls `https://api.anthropic.com/api/oauth/usage` (Bearer + `anthropic-beta: oauth-2025-04-20`), parses `five_hour`/`seven_day`/`seven_day_sonnet`. Utilization is already 0-100 (not a 0-1 fraction) — see `TokenUsageBadge.tsx` for the reference scale. |
| `TrayIconService.cs` | Owns the `TaskbarIcon`, polls every 5 minutes (+ manual "Refresh now"), redraws the icon, builds the tooltip, and handles the "Start with Windows" registry toggle (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`). |

## Icon style setting

Right-click the tray icon → "Icon: Number" / "Icon: Bars" (checkmark shows the active one).
Persisted at `HKCU\Software\ClaudeTokenTray\IconStyle` (`Number` default, or `Bars`). Both
styles are rendered by `TrayIconService.Render()`, which dispatches on a `DisplayState`
(`Loading`/`Usage`/`NotLoggedIn`/`Error`) + the selected `IconStyle` so switching styles
mid-session redraws immediately from whatever state is currently shown, without a re-fetch.

- **Number**: existing colored-circle + percentage-of-5h digit (`SetIconText`/`SetIconNumber`).
- **Bars**: two vertical meters side by side on the 64px canvas — left = 5h window, right = 7d
  window — each filled bottom-up by utilization % in the same severity color as Number style
  (`SetIconBars`/`DrawBar`). Only usage windows with data get a bar; the not-logged-in/error/
  loading states always fall back to the Number-style text rendering since there's no
  percentage to show as a bar.

Regardless of icon style, hovering the tray icon shows a custom `TaskbarIcon.TrayToolTip`
(`BuildTooltipContent`) with the same left-to-right bar visual per usage window (5h, 7d, 7d
Sonnet) plus percentage and reset time — so the bar breakdown is always available on hover, not
just when "Bars" is the active icon style. `ToolTipText` (plain string) is still set alongside
it as the fallback for contexts that don't support custom tooltips.

## Build / run

```
cd windows-tray/ClaudeTokenTray
dotnet build
dotnet run   # launches packaged app straight to tray, no window
```

## Gotcha: `H.NotifyIcon.WinUI`'s `GeneratedIconSource` never centers text

Used for the tray icon (via `H.NotifyIcon.WinUI` + `TaskbarIcon`). The obvious approach —
`TaskbarIcon.IconSource` set to a `GeneratedIconSource` with `Text`/`Foreground`/`Background` —
renders text **anchored top-left, never centered**, even though the library's source has a
dead code path that looks like it should auto-center.

Root cause (traced into `H.NotifyIcon` v2.4.1 source): `GeneratedIconSource.Generate()` always
passes a non-null `textRectangle` (derived from the `TextMargin` dependency property, which is
a `Thickness` struct — never actually null). `SystemDrawingIconGenerator.Generate()` only
measures-and-centers text when `textRectangle == null`; since it's never null when called via
`GeneratedIconSource`, text is drawn with `StringFormat.GenericTypographic`'s default
(top-left) alignment. On a small tray icon (downscaled to ~16-32px), a digit or two drawn from
the top-left corner of a square lands mostly **outside** any circular/rounded background,
reading as garbled or entirely invisible.

**Fix:** don't use `IconSource`/`GeneratedIconSource` for text-bearing icons. Render the bitmap
manually with `System.Drawing` (`Graphics.DrawString` with a centered `StringFormat`), convert
via `bitmap.GetHicon()` → `Icon.FromHandle(...)`, and assign to `TaskbarIcon.Icon` (a plain
`System.Drawing.Icon` property `H.NotifyIcon` exposes specifically for this). `Icon.FromHandle`
does not own the HICON — call `DestroyIcon` (user32.dll) on the previous icon's handle each
time it's replaced, or GDI handles leak over the app's lifetime. See `TrayIconService.SetIconText`
(text/number style) and `SetIconBars` (bars style) — both funnel through `ApplyBitmap` for the
HICON conversion + previous-handle cleanup.

## Gotcha: `Windows.UI.Colors` doesn't exist in this WinUI 3 projection

`Windows.UI.Color` (the struct, e.g. `Windows.UI.Color.FromArgb(...)`) resolves fine, but the
static `Colors` palette class (`Colors.White`, `Colors.Gray`, ...) does **not** live under
`Windows.UI` here — it's `Microsoft.UI.Colors.White` / `Microsoft.UI.Colors.Gray`. Using
`Windows.UI.Colors.X` fails with `CS0234: The type or namespace name 'Colors' does not exist in
the namespace 'Windows.UI'`. Easy to get wrong since UWP/older WinUI samples online use
`Windows.UI.Colors`. Same split applies to `FontWeights` (`Microsoft.UI.Text.FontWeights`, not
`Windows.UI.Text`).

## Gotcha: `dotnet run`/`dotnet build` fails with MSB3027 if a previous instance is still running

The packaging step copies `apphost.exe` → `AppX\ClaudeTokenTray.exe`, which fails ("file locked
by: ClaudeTokenTray (PID)") if an earlier build of the app is still running in the tray —
including one started via the "Start with Windows" registry toggle. Stop the running process
(`Stop-Process -Id <pid> -Force`) before re-running `dotnet build`/`dotnet run`.
