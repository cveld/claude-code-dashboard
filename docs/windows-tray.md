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
| `SessionMemoryUsage.cs` / `SessionMemoryClient.cs` | C# counterpart of `app/api/active-sessions/route.ts`'s memory lookup / `MemoryUsageBadge.tsx`: reads `~/.claude/sessions/*.json` for active session `pid`/`cwd`, then queries `Process.GetProcessById(pid).WorkingSet64`/`PagedMemorySize64` directly (no PowerShell shell-out needed in-process). Returns `null` when no sessions are active. |
| `TrayIconService.cs` | Owns the `TaskbarIcon`, polls every 5 minutes (+ manual "Refresh now"), redraws the icon, builds the tooltip, and handles the "Start with Windows" registry toggle (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`). Also appends a `UsageSample` to `UsageHistoryStore` on every poll (success or failure) for the history window's charts. |
| `UsageSample.cs` | One poll's worth of data: `Timestamp`, `FiveHour`/`SevenDay`/`SevenDaySonnet` (nullable %), `MemoryBytes`/`PagedMemoryBytes`/`SessionCount`, and `FiveHourResetsAt`/`SevenDayResetsAt`/`SevenDaySonnetResetsAt` (nullable — the exact `resets_at` the API reported for that window on that poll). Every field nullable by design: a failed usage fetch still records a memory-only sample, and vice versa. |
| `UsageHistoryStore.cs` | Append-only JSON Lines log at `%LOCALAPPDATA%\ClaudeTokenTray\history.jsonl` (compact keys: `t`,`h5`,`d7`,`d7s`,`mem`,`paged`,`sessions`,`h5r`,`d7r`,`d7sr`). `Load(since)` reads + filters + sorts ascending; `Prune(retention)` rewrites through a temp file. ~30 days of 5-min samples ≈ 1 MB. |
| `UsageFormat.cs` | Shared formatting (percent, byte sizes, time-remaining, session count) used by both the tray tooltip and the history window, so the two never disagree on wording. |
| `TraySettings.cs` | Thin wrapper around `HKCU\Software\ClaudeTokenTray` for small persisted values (currently the history window's saved width/height). |
| `HistoryWindow.xaml(.cs)` / `UsageChartRenderer.cs` | The "Claude usage history" window (opened by clicking the tray icon) and its chart rendering. See "History window" below. |

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

## Memory usage

Each poll also refreshes per-process RAM/paged memory for active Claude Code sessions
(`SessionMemoryClient.GetUsage`), summarized as "N sessions · X RAM · Y paged" — the tray
equivalent of the dashboard's `MemoryUsageBadge`. This line is appended to `ToolTipText` in
every `DisplayState` (Loading/Usage/NotLoggedIn/Error), and also rendered as an extra row inside
`BuildTooltipContent` when in the `Usage` state. If no `~/.claude/sessions/*.json` file resolves
to a still-running pid, `_memoryUsage` stays `null` and the line is omitted entirely rather than
showing "0 sessions".

## History window

Clicking the tray icon opens/activates `HistoryWindow` (built once, hidden not destroyed on
close — see the class-level comment in `HistoryWindow.xaml.cs`). Three stacked charts (Quota,
Memory, Active sessions), all drawn as plain WinUI shapes on a `Canvas` by `UsageChartRenderer`
— no charting package. All three panels share one x-axis and one `PlotRect` mapping per redraw.

**Period tabs (6h/24h/7d/30d)** set `_selectedPeriod`; `_from`/`_to`/`_viewTo` are recomputed
every `Redraw()` (30s timer, resize, activation, period click, or scrub).

**Live counters row** ("Token usage" line) doubles as the chart legend — each chip's dot is the
series' own color, so a separate legend would just repeat the same labels. A series with no data
at all (e.g. `seven_day_sonnet` on plans that don't have it — see below) simply produces no chip;
nothing is hidden explicitly, `AddCounterChip` just returns early when the value is null.

**Window-reset boundaries are computed from the API's own `resets_at`, never extrapolated across
cycles.** For every distinct `resets_at` value seen in the loaded samples,
`UsageChartRenderer.DrawWindowBoundaries` draws a dashed "X start" line at `resetsAt -
nominalPeriod` (5h / 7d, passed in per series). That subtraction is a hard fact, not a guess: a
fixed-length window's start is definitionally its end minus its length, so this holds for the
very first window in the loaded history just as much as for one observed rolling over live —
there's no "confirmed vs. estimated" distinction to make. Null samples (failed polls) are skipped
rather than treated as a change, so a transient API error doesn't get mistaken for a reset.

Windows also aren't guaranteed to butt up back-to-back — an idle account's next window only starts
on its next actual usage, not on a clock, so there can be a real gap between one window ending and
the next one starting. `DrawWindowBoundaries` draws both ends of that gap: the *previous* window's
own end (the old `resets_at` value itself, no computation needed) alongside the new window's
computed start — but only when they're actually apart by more than `ResetJitterTolerance`; if the
new window's computed start lands right on top of the "reset" line just drawn (no idle gap), the
"start" line is skipped so the two don't double up on the same instant a couple pixels apart. Both
5h and 7d keep their own *upcoming* reset off (`drawUpcoming: false`, only relevant for the current
still-running window) — between the live counters row, the axis stretching out to meet it, and
`AddPrediction`'s own hollow marker already sitting right where that reset lands, the extra dashed
"X reset" line + label was redundant clutter rather than new information. 7d-Sonnet still draws it
(`drawUpcoming: true`) since it's an even rarer event on the accounts that have it at all.

An earlier version instead drew the "start" line at the *poll timestamp* that first noticed
`resets_at` had changed — treating the change itself as the observed event. That reads fine when
polls are 5 minutes apart, but a gap in polling that straddles the real rollover (laptop
asleep/hibernated, the tray app not running, a missed poll) makes the next successful poll land
well after the actual reset, and the line was drawn at that later "we noticed" timestamp instead
of the true boundary — e.g. a window that actually started at 05:30 getting drawn with its "5h
start" line at 09:03, wherever polling happened to resume. Computing directly from `resetsAt -
nominalPeriod` sidesteps this entirely: the line's position no longer depends on when a poll
happened to catch the change, only on the reset time the API itself reported.

The API re-stamps `resets_at` with a fresh sub-second fraction on *every* poll, even when the
reset itself hasn't moved (visible in `history.jsonl`: the same nominal reset minute recorded
with a different fractional second on every 5-min sample). A raw inequality check therefore
treated every single poll as a rollover, drawing a boundary line on nearly every sample — the "way
too many 7d lines" bug. `ResetJitterTolerance` (2 minutes) absorbs that jitter: only a change
bigger than that counts as a real rollover, since actual rollovers move `resets_at` by a whole
window (hours/days).

**Top-of-chart label collisions**: "now", the 90% warn line, and each series' start/reset tag all
want to sit near the top of the quota chart and often land close together on the x-axis — live,
"now" and an imminent reset can be only a few pixels apart, and a fresh history can draw several
series' fallback "start" tags near the same spot. `UsageChartRenderer.TopLabelLayout` is shared
across `DrawNowMarker`/`DrawWarnLine`/`DrawWindowBoundaries` for one `DrawQuota` call so they all
place through the same instance: each tag claims the first row (top to bottom) whose horizontal
span isn't already taken by an earlier one, stacking colliding tags into extra rows instead of
drawing them through each other. The 90% label is also anchored at the *left* end of its line now
(it used to sit at the right, on top of where "now"/reset tags usually land).

**Prediction** (`AddPrediction`): fits a straight line through this window's samples to get a
*rate* of increase (%/second) — a plain least-squares fit over (seconds-since-latest-sample,
value) pairs, needing ≥2 points spanning ≥15 min (`MinTrendSpan`) or it just reports the flat
current %. Which samples belong to the window is decided by matching each sample's own reported
`resetsAt` against the current one (within `ResetJitterTolerance`), not by "is this sample's
timestamp after some computed window start" — that used to let the *previous* window's tail leak
into the regression whenever there was a gap between the two (see the boundary-line note above on
windows not butting up back-to-back), silently skewing the fitted rate with data from a different
cycle.

Crucially, the projection is anchored on the *actual latest reading*, not on the fitted line's own
value evaluated at "now": `projectedAtReset = currentValue + rate * secondsToReset`, clamped with
a **floor of `currentValue`** (not 0). A least-squares line has no obligation to pass through the
last data point — if the fit sits even slightly below the latest real reading (ordinary noise),
extrapolating from the fit itself could read as a *drop* below the current %. Since utilization is
cumulative usage against a quota, it can only climb within a window, so any projection reading
below the current value is definitionally wrong, not just imprecise — the floor exists to make
that invariant hold structurally rather than trusting the regression to always be well-behaved.
This also fixed a mismatch in the drawn dashed line itself: it starts at the real
`(latest.Timestamp, currentValue)` point, so anchoring the far end on that same point keeps the
line's visible slope consistent with where it starts, instead of occasionally sloping backward
toward a lower fitted value.

Extrapolated to either the moment it crosses 100% (if that happens before reset) or to the reset
itself, and drawn as a dashed continuation of the series' own line/color plus a plain-language
sentence under the chart. Its hollow-circle marker landing at (or before) the reset point is also
why the boundary lines above skip drawing each window's own *upcoming* reset separately — the
prediction already marks it.

**Live axis extension + the "broken axis" compression**: when live (not scrolled), the plotted
axis (`_viewTo`, `HistoryWindow.ComputeLiveViewTo`) stretches past "now" to the furthest known
upcoming reset, so the prediction line has room to actually draw forward instead of being
clipped at the right edge (plus ~8% padding, min 10 min, so it doesn't sit flush on the edge
either). If that future stretch would linearly take up more than `FutureStripWidthPx` (~1cm at
96 DPI) of the panel, `PlotRect` compresses it into a fixed-width strip instead — two short
diagonal ticks (`DrawAxisBreak`) mark where the scale changes, same idea as a broken axis in a
regular chart. Without this, a 6h/24h zoom with a 7d reset a day away would squeeze the requested
6h/24h of real history into a sliver next to a mostly-empty future stretch.

**Time scrubber**: not a `Slider` — a plain `Canvas` (`TimeScrubberCanvas`) drawn by
`HistoryWindow.DrawTimeScrubber`. A draggable bar represents the current viewport `[_from, _to]`
(or `[_from, _viewTo]` when live) against the full scrollable range, over a blue/grey
availability minimap (`DrawAvailabilitySegments`) showing where samples actually exist. Dragging
(`PointerPressed`/`Moved`/`Released`, pointer capture) centers the viewport on whatever moment is
under the pointer via `PinTo`. The ruler's own scale (`LiveScrubberRangeEnd`) is always computed
as if live, even while dragging/pinned — using the shrunk pinned `_viewTo` instead would rescale
the whole ruler the instant a drag lands back on "now", which read as a glitch. "Jump to now" is
always visible, just disabled (not hidden) while already live.

The ruler's right edge (`LiveScrubberRangeEnd`) stretches to the furthest known upcoming reset,
same as the charts' `_viewTo` — but that horizon can be minutes or a full 7 days out depending on
which window resets soonest. Mapping it linearly onto the bar let a distant reset swallow almost
the whole track, squeezing real, scrollable history into a sliver against the left edge and
making "now" jump around based on nothing but reset timing. `ScrubberScale`
(`HistoryWindow.ComputeScrubberScale`) caps the projected portion at `MaxScrubberFutureStripPx`
(40px), same idea as the charts' broken axis: below the cap it still scales 1:1 (so it grows
smoothly as a reset approaches), above it extra distance costs no more width, so "now" stays put
instead of jumping and the future sliver visibly shrinks in as the real reset gets closer rather
than popping in at a wildly different scale. `ScrubberScale` is shared by drawing (`XFor`, time →
x) and dragging (`TimeFor`, x → time) so the two can't drift apart — the reverse mapping used by
`ScrubTo` has to match what's drawn or dragging feels off relative to the bar under the pointer.

**Layout**: header, live counters, readout and the time scrubber are `Auto` rows of the *outer*
grid; only the three charts sit inside a `ScrollViewer` in the middle `*` row. This is
deliberate — earlier the charts' `MinHeight`s could add up to more than the window's own declared
minimum height, silently pushing the scrubber off the bottom of the window with nothing to
scroll to it. Now the scrubber can never be clipped; the charts scroll instead.

**`seven_day_sonnet` and friends**: the raw `/api/oauth/usage` response also contains several
always-null-for-most-accounts keys (`seven_day_opus`, `seven_day_oauth_apps`,
`seven_day_cowork`, `nimbus_quill`, `cinder_cove`, `amber_ladder`, `tangelo`,
`iguana_necktie`, `omelette_promotional`) — presumably plan/experiment-gated limit variants.
Only `five_hour`/`seven_day`/`seven_day_sonnet` are parsed; don't assume a null
`seven_day_sonnet` is a bug, it may just not apply to the signed-in account's plan.

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

## Gotcha: `Environment.SpecialFolder.LocalApplicationData` is redirected for this packaged app

Because the project builds with `<EnableMsixTooling>true</EnableMsixTooling>` / package identity
(via `dotnet run`'s sparse-package debug registration), `Environment.GetFolderPath(LocalApplicationData)`
does **not** resolve to the plain `%LOCALAPPDATA%\ClaudeTokenTray\` you'd expect — it resolves to
a per-package-identity folder:
`%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\Local\ClaudeTokenTray\history.jsonl`.
The app itself is internally consistent (reads/writes always go through the same
`UsageHistoryStore.FilePath`), but inspecting `history.jsonl` by hand from outside the app — e.g.
`Get-Content "$env:LOCALAPPDATA\ClaudeTokenTray\history.jsonl"` — silently looks at a
nonexistent/wrong path. Find the real one with:
```powershell
Get-ChildItem "$env:LOCALAPPDATA\Packages" -Filter "history.jsonl" -Recurse
```

## Gotcha: a `Canvas` with no `Background` isn't hit-testable across its blank area

`PointerMoved`/`PointerWheelChanged`/`PointerPressed` handlers attached directly to a `Canvas`
only fire where the pointer is actually over a drawn child (a `Line`, `Rectangle`, etc.) — empty
space inside the canvas's bounds does **not** count as "over the canvas" for hit-testing unless
the canvas has an explicit `Background` (even `Transparent` is enough; `null`/unset is not). This
silently broke mouse-wheel scrubbing on the history charts — the wheel handler only fired when
the cursor happened to sit exactly on a rendered line. Fix: `Background="Transparent"` on every
canvas that needs pointer events across its whole area (`QuotaCanvas`/`MemoryCanvas`/
`SessionsCanvas`/`TimeScrubberCanvas` in `HistoryWindow.xaml`).

## Gotcha: `TextBlock` has no `Background` property in WinUI (unlike WPF)

Setting `Background` on a `TextBlock` in code (`new TextBlock { Background = ... }`) is a
compile error (`CS0117`) — WinUI's `TextBlock`, unlike WPF's, doesn't expose one. Wrap it in a
`Border` (`Background` + `CornerRadius` + `Padding` on the `Border`, plain `TextBlock` as
`Child`) to get a background behind text, e.g. the scrubber's drag-tooltip label in
`HistoryWindow.DrawTimeScrubber`.
