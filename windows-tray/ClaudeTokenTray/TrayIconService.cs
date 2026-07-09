using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text;
using H.NotifyIcon;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.Win32;

namespace ClaudeTokenTray;

public sealed class TrayIconService : IDisposable
{
    private const int IconSize = 64;
    private const int BarWidth = 22;
    private const int BarTop = 6;
    private const int BarBottom = IconSize - 6;
    private const int BarHeight = BarBottom - BarTop;
    private const int BarRadius = 8;
    private const int BarLeftX = 6;
    private const int BarRightX = 36;

    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(5);
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunKeyName = "ClaudeTokenTray";
    private const string SettingsKeyPath = @"Software\ClaudeTokenTray";
    private const string IconStyleValueName = "IconStyle";

    private enum IconStyle { Number, Bars }

    private enum DisplayState { Loading, Usage, NotLoggedIn, Error }

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr handle);

    private readonly TaskbarIcon _trayIcon;
    private readonly XamlUICommand _refreshCommand;
    private readonly XamlUICommand _iconStyleNumberCommand;
    private readonly XamlUICommand _iconStyleBarsCommand;
    private readonly XamlUICommand _startWithWindowsCommand;
    private readonly XamlUICommand _exitCommand;
    private readonly DispatcherQueueTimer _timer;

    private Icon? _currentIcon;
    private TokenUsage? _lastGood;
    private IconStyle _iconStyle;
    private DisplayState _state = DisplayState.Loading;
    private bool _stale;

    public TrayIconService(TaskbarIcon trayIcon)
    {
        _trayIcon = trayIcon;
        _iconStyle = LoadIconStyle();

        var resources = Application.Current.Resources;
        _refreshCommand = (XamlUICommand)resources["RefreshCommand"];
        _iconStyleNumberCommand = (XamlUICommand)resources["IconStyleNumberCommand"];
        _iconStyleBarsCommand = (XamlUICommand)resources["IconStyleBarsCommand"];
        _startWithWindowsCommand = (XamlUICommand)resources["StartWithWindowsCommand"];
        _exitCommand = (XamlUICommand)resources["ExitCommand"];

        _refreshCommand.ExecuteRequested += (_, _) => _ = RefreshAsync();
        _iconStyleNumberCommand.ExecuteRequested += (_, _) => SetIconStyle(IconStyle.Number);
        _iconStyleBarsCommand.ExecuteRequested += (_, _) => SetIconStyle(IconStyle.Bars);
        _startWithWindowsCommand.ExecuteRequested += (_, _) => ToggleStartWithWindows();
        _exitCommand.ExecuteRequested += (_, _) => Exit();

        UpdateStartWithWindowsLabel();
        UpdateIconStyleLabels();
        Render();

        _trayIcon.ForceCreate();

        _timer = DispatcherQueue.GetForCurrentThread().CreateTimer();
        _timer.Interval = PollInterval;
        _timer.Tick += (_, _) => _ = RefreshAsync();
        _timer.Start();

        _ = RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        try
        {
            var usage = await TokenUsageClient.GetUsageAsync().ConfigureAwait(true);
            _lastGood = usage;
            ApplyUsage(usage, stale: false);
        }
        catch (TokenUsageException ex) when (ex.Message == "no_credentials")
        {
            ApplyNotLoggedIn();
        }
        catch (TokenUsageException)
        {
            if (_lastGood is not null)
                ApplyUsage(_lastGood, stale: true);
            else
                ApplyError();
        }
    }

    private void ApplyUsage(TokenUsage usage, bool stale)
    {
        _lastGood = usage;
        _state = DisplayState.Usage;
        _stale = stale;
        Render();
    }

    private void ApplyNotLoggedIn()
    {
        _state = DisplayState.NotLoggedIn;
        Render();
    }

    private void ApplyError()
    {
        _state = DisplayState.Error;
        Render();
    }

    private void SetIconStyle(IconStyle style)
    {
        if (_iconStyle == style) return;

        _iconStyle = style;
        SaveIconStyle(style);
        UpdateIconStyleLabels();
        Render();
    }

    private void UpdateIconStyleLabels()
    {
        _iconStyleNumberCommand.Label = _iconStyle == IconStyle.Number ? "✓ Icon: Number" : "Icon: Number";
        _iconStyleBarsCommand.Label = _iconStyle == IconStyle.Bars ? "✓ Icon: Bars" : "Icon: Bars";
    }

    // Redraws the icon and tooltip for the current DisplayState/IconStyle. Called both when new
    // usage data arrives and when the user switches icon style, so the two never drift apart.
    private void Render()
    {
        switch (_state)
        {
            case DisplayState.Loading:
                SetIconText("…", Color.Gray);
                _trayIcon.ToolTipText = "Claude token usage";
                _trayIcon.TrayToolTip = null;
                break;

            case DisplayState.NotLoggedIn:
                SetIconText("!", Color.Gray);
                _trayIcon.ToolTipText = "Not logged in to Claude";
                _trayIcon.TrayToolTip = null;
                break;

            case DisplayState.Error:
                SetIconText("?", Color.Gray);
                _trayIcon.ToolTipText = "Failed to reach Claude usage API";
                _trayIcon.TrayToolTip = null;
                break;

            case DisplayState.Usage:
                var usage = _lastGood!;
                if (_iconStyle == IconStyle.Bars)
                    SetIconBars(usage);
                else
                    SetIconNumber(usage);

                var tooltipText = BuildTooltipText(usage);
                if (_stale)
                    tooltipText += "\n(stale - last refresh failed)";
                _trayIcon.ToolTipText = Truncate(tooltipText);
                _trayIcon.TrayToolTip = BuildTooltipContent(usage, _stale);
                break;
        }
    }

    private void SetIconNumber(TokenUsage usage)
    {
        var fiveHour = usage.FiveHour;
        var pct = fiveHour is null ? (int?)null : Math.Clamp((int)Math.Round(fiveHour.Utilization), 0, 100);
        SetIconText(pct?.ToString() ?? "?", ColorForPercent(pct));
    }

    // Tray icons render at ~16-32px on screen, so text is drawn on a larger
    // (IconSize) canvas with centered layout and a colored circle backdrop -
    // far more legible after downscaling than raw colored text.
    private void SetIconText(string text, Color color)
    {
        using var bitmap = new Bitmap(IconSize, IconSize);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

            using var backgroundBrush = new SolidBrush(color);
            graphics.FillEllipse(backgroundBrush, 0, 0, IconSize, IconSize);

            var fontSize = text.Length switch
            {
                <= 1 => IconSize * 0.55f,
                2 => IconSize * 0.42f,
                _ => IconSize * 0.32f,
            };
            using var font = new Font("Segoe UI", fontSize, System.Drawing.FontStyle.Bold, GraphicsUnit.Pixel);
            using var textBrush = new SolidBrush(Color.White);
            using var format = new StringFormat
            {
                Alignment = StringAlignment.Center,
                LineAlignment = StringAlignment.Center,
            };
            graphics.DrawString(text, font, textBrush, new RectangleF(0, 0, IconSize, IconSize), format);
        }

        ApplyBitmap(bitmap);
    }

    // Two vertical meters: left = 5h window, right = 7d window. Each fills bottom-up by
    // utilization percentage, in the same severity color as the number style.
    private void SetIconBars(TokenUsage usage)
    {
        using var bitmap = new Bitmap(IconSize, IconSize);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            DrawBar(graphics, BarLeftX, usage.FiveHour);
            DrawBar(graphics, BarRightX, usage.SevenDay);
        }

        ApplyBitmap(bitmap);
    }

    private static void DrawBar(Graphics graphics, int x, UsageLimitWindow? window)
    {
        var trackRect = new Rectangle(x, BarTop, BarWidth, BarHeight);
        using var trackPath = RoundedRect(trackRect, BarRadius);

        using var trackBrush = new SolidBrush(Color.FromArgb(70, 128, 128, 128));
        graphics.FillPath(trackBrush, trackPath);

        if (window is null) return;

        var pct = Math.Clamp((int)Math.Round(window.Utilization), 0, 100);
        if (pct <= 0) return;

        var fillHeight = (int)Math.Round(BarHeight * (pct / 100.0));
        var fillRect = new Rectangle(x, trackRect.Bottom - fillHeight, BarWidth, fillHeight);

        var previousClip = graphics.Clip;
        graphics.SetClip(trackPath);
        using var fillBrush = new SolidBrush(ColorForPercent(pct));
        graphics.FillRectangle(fillBrush, fillRect);
        graphics.Clip = previousClip;
    }

    private static GraphicsPath RoundedRect(Rectangle bounds, int radius)
    {
        var d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private void ApplyBitmap(Bitmap bitmap)
    {
        var previousIcon = _currentIcon;

        var hIcon = bitmap.GetHicon();
        _currentIcon = Icon.FromHandle(hIcon);
        _trayIcon.Icon = _currentIcon;

        if (previousIcon is not null)
        {
            DestroyIcon(previousIcon.Handle);
            previousIcon.Dispose();
        }
    }

    private static Color ColorForPercent(int? pct) => pct switch
    {
        null => Color.Gray,
        >= 90 => Color.FromArgb(0xEF, 0x44, 0x44),
        >= 70 => Color.FromArgb(0xF5, 0x9E, 0x0B),
        _ => Color.FromArgb(0x3B, 0x82, 0xF6),
    };

    private static string BuildTooltipText(TokenUsage usage)
    {
        var sb = new StringBuilder("Claude token usage");
        AppendWindow(sb, "5h", usage.FiveHour);
        AppendWindow(sb, "7d", usage.SevenDay);
        AppendWindow(sb, "7d Sonnet", usage.SevenDaySonnet);
        return sb.ToString();
    }

    private static void AppendWindow(StringBuilder sb, string label, UsageLimitWindow? window)
    {
        if (window is null) return;
        var pct = Math.Clamp((int)Math.Round(window.Utilization), 0, 100);
        sb.Append($"\n{label}: {pct}%");
        var remaining = FormatTimeRemaining(window.ResetsAt);
        if (remaining is not null)
            sb.Append($" (resets in {remaining})");
    }

    // Custom hover popup shown regardless of icon style: same left-5h/right-... bar visual as
    // the icon itself, one row per usage window, so the breakdown is always available on hover.
    private static UIElement BuildTooltipContent(TokenUsage usage, bool stale)
    {
        var root = new StackPanel
        {
            Padding = new Thickness(12),
            Spacing = 6,
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 32, 32, 32)),
        };

        root.Children.Add(new TextBlock
        {
            Text = "Claude token usage",
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
            Margin = new Thickness(0, 0, 0, 4),
        });

        AddTooltipRow(root, "5h", usage.FiveHour);
        AddTooltipRow(root, "7d", usage.SevenDay);
        AddTooltipRow(root, "7d Sonnet", usage.SevenDaySonnet);

        if (stale)
        {
            root.Children.Add(new TextBlock
            {
                Text = "(stale - last refresh failed)",
                FontStyle = Windows.UI.Text.FontStyle.Italic,
                Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray),
                FontSize = 11,
                Margin = new Thickness(0, 4, 0, 0),
            });
        }

        return root;
    }

    private static void AddTooltipRow(StackPanel root, string label, UsageLimitWindow? window)
    {
        if (window is null) return;

        var pct = Math.Clamp((int)Math.Round(window.Utilization), 0, 100);
        var color = ColorForPercent(pct);
        var remaining = FormatTimeRemaining(window.ResetsAt);

        var row = new Grid { ColumnSpacing = 10 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(72) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(120) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelBlock = new TextBlock
        {
            Text = label,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(labelBlock, 0);

        var barContainer = new Grid { Width = 120, Height = 10, VerticalAlignment = VerticalAlignment.Center };
        barContainer.Children.Add(new Border
        {
            Width = 120,
            Height = 10,
            CornerRadius = new CornerRadius(5),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(60, 255, 255, 255)),
        });
        barContainer.Children.Add(new Border
        {
            Width = 120 * pct / 100.0,
            Height = 10,
            CornerRadius = new CornerRadius(5),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, color.R, color.G, color.B)),
            HorizontalAlignment = HorizontalAlignment.Left,
        });
        Grid.SetColumn(barContainer, 1);

        var pctText = remaining is null ? $"{pct}%" : $"{pct}% ({remaining})";
        var valueBlock = new TextBlock
        {
            Text = pctText,
            Foreground = new SolidColorBrush(Microsoft.UI.Colors.White),
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 11,
        };
        Grid.SetColumn(valueBlock, 2);

        row.Children.Add(labelBlock);
        row.Children.Add(barContainer);
        row.Children.Add(valueBlock);
        root.Children.Add(row);
    }

    private static string? FormatTimeRemaining(DateTimeOffset? resetsAt)
    {
        if (resetsAt is null) return null;
        var remaining = resetsAt.Value - DateTimeOffset.Now;
        if (remaining <= TimeSpan.Zero) return "resetting...";

        var totalMinutes = (int)Math.Ceiling(remaining.TotalMinutes);
        var hours = totalMinutes / 60;
        var minutes = totalMinutes % 60;
        if (hours >= 24)
        {
            var days = hours / 24;
            var remHours = hours % 24;
            return remHours > 0 ? $"{days}d{remHours}h" : $"{days}d";
        }
        return hours > 0 ? $"{hours}h{(minutes > 0 ? $"{minutes}m" : "")}" : $"{minutes}m";
    }

    private static string Truncate(string text) => text.Length <= 127 ? text : text[..127];

    private static IconStyle LoadIconStyle()
    {
        using var key = Registry.CurrentUser.OpenSubKey(SettingsKeyPath, writable: false);
        var raw = key?.GetValue(IconStyleValueName) as string;
        return raw == nameof(IconStyle.Bars) ? IconStyle.Bars : IconStyle.Number;
    }

    private static void SaveIconStyle(IconStyle style)
    {
        using var key = Registry.CurrentUser.CreateSubKey(SettingsKeyPath);
        key.SetValue(IconStyleValueName, style.ToString());
    }

    private void ToggleStartWithWindows()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        if (key is null) return;

        if (key.GetValue(RunKeyName) is not null)
        {
            key.DeleteValue(RunKeyName, throwOnMissingValue: false);
        }
        else
        {
            var exePath = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
            if (exePath is not null)
                key.SetValue(RunKeyName, $"\"{exePath}\"");
        }

        UpdateStartWithWindowsLabel();
    }

    private void UpdateStartWithWindowsLabel()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        var isEnabled = key?.GetValue(RunKeyName) is not null;
        _startWithWindowsCommand.Label = isEnabled ? "✓ Start with Windows" : "Start with Windows";
    }

    private void Exit()
    {
        _timer.Stop();
        _trayIcon.Dispose();
        Environment.Exit(0);
    }

    public void Dispose()
    {
        _timer.Stop();
        _trayIcon.Dispose();
        if (_currentIcon is not null)
        {
            DestroyIcon(_currentIcon.Handle);
            _currentIcon.Dispose();
        }
    }
}
