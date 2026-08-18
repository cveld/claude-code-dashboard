using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Color = Windows.UI.Color;
using Icon = System.Drawing.Icon;

namespace ClaudeTokenTray;

// This app's only window. This app never runs its own Exit UI (that's the tray icon's
// right-click menu) - the title bar's close button must not take the process down with it, so
// AppWindow.Closing is cancelled and the window is hidden instead of destroyed. That also means
// the window survives for the app's whole lifetime and is only ever built once.
public sealed partial class HistoryWindow : Window
{
    private const string IdleReadout = "Hover a chart to inspect a point";
    private const string WidthSetting = "HistoryWindowWidth";
    private const string HeightSetting = "HistoryWindowHeight";

    // A first-ever launch (no saved size yet) opens generously large rather than at the content's
    // bare minimum - the three chart panels read as cramped when the window sits right at its floor.
    private static readonly Windows.Graphics.SizeInt32 DefaultSize = new(640, 820);
    private const int MinWidth = 420;
    private const int MinHeight = 560;

    private TimeSpan _selectedPeriod = TimeSpan.FromHours(24);
    private DateTimeOffset _from;
    private DateTimeOffset _to;

    // The actual right edge of the plotted axis. Equal to _to except when live, where it's
    // stretched to cover the furthest upcoming window reset - that's what gives a live
    // prediction room to actually draw forward instead of being squashed against "now".
    private DateTimeOffset _viewTo;

    private IReadOnlyList<UsageSample> _samples = [];

    // Null means "pinned to the live edge" - _to tracks DateTimeOffset.Now on every redraw. Once
    // the user scrubs backward this holds the fixed right edge of the viewport instead, so a
    // scrolled-back view doesn't silently drift forward as the refresh timer keeps ticking.
    private DateTimeOffset? _pinnedTo;

    // True while the pointer is down on the scrubber - swaps its label to the current range and
    // keeps mouse moves outside its bounds (PointerMoved is only hooked on the canvas itself, but
    // capture means it still fires there) driving the drag.
    private bool _scrubberDragging;

    // Drawn once and kept for the window's lifetime - Icon.FromHandle doesn't own the HICON, so
    // this field only keeps the managed wrapper alive; the handle itself just outlives the process.
    private readonly Icon _windowIcon = CreateWindowIcon();

    private readonly DispatcherQueueTimer _refreshTimer;

    public HistoryWindow()
    {
        InitializeComponent();

        AppWindow.SetIcon(Win32Interop.GetIconIdFromIcon(_windowIcon.Handle));
        AppWindow.Resize(LoadSavedSize());
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.PreferredMinimumWidth = MinWidth;
            presenter.PreferredMinimumHeight = MinHeight;
        }

        AppWindow.Closing += AppWindow_Closing;
        AppWindow.Changed += AppWindow_Changed;

        InitializeStyles();
        HookEvents();

        SetSelectedPeriodButtonVisuals(Btn24h);
        ReadoutText.Text = IdleReadout;

        Redraw();

        // The tray keeps polling and appending samples every 5 minutes regardless of whether
        // this window is open; without its own timer the charts only ever caught up on the next
        // period-tab click, resize, or window activation, which read as "not updating".
        _refreshTimer = DispatcherQueue.CreateTimer();
        _refreshTimer.Interval = TimeSpan.FromSeconds(30);
        _refreshTimer.Tick += (_, _) => Redraw();
        _refreshTimer.Start();
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    private static readonly IntPtr HwndTopmost = new(-1);
    private static readonly IntPtr HwndNoTopmost = new(-2);
    private const uint SwpNoMoveNoSize = 0x0002 | 0x0001;

    // Called every time the tray icon is clicked: refreshes with whatever history has
    // accumulated since the window was last shown, then brings it to the foreground - whether
    // it was hidden, minimized, or already open behind some other window.
    public void ShowAndActivate()
    {
        Redraw();

        if (AppWindow.Presenter is OverlappedPresenter { State: OverlappedPresenterState.Minimized } presenter)
            presenter.Restore();

        AppWindow.Show();

        // Window.Activate() alone can be silently denied by Windows' foreground-lock: by the
        // time this runs, the click that triggered it may no longer count as "recent input" in
        // the same thread's eyes. Toggling topmost forces this window above everything else
        // first, which reliably wins the foreground switch regardless of that timing.
        var hwnd = Win32Interop.GetWindowFromWindowId(AppWindow.Id);
        SetWindowPos(hwnd, HwndTopmost, 0, 0, 0, 0, SwpNoMoveNoSize);
        SetWindowPos(hwnd, HwndNoTopmost, 0, 0, 0, 0, SwpNoMoveNoSize);
        SetForegroundWindow(hwnd);
        Activate();
    }

    private void AppWindow_Closing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        args.Cancel = true;
        AppWindow.Hide();
    }

    // Persists whatever size the user leaves the window at, so a resize sticks across app
    // restarts instead of reverting to a guessed default every time.
    private void AppWindow_Changed(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (!args.DidSizeChange)
            return;

        TraySettings.Write(WidthSetting, sender.Size.Width.ToString(CultureInfo.InvariantCulture));
        TraySettings.Write(HeightSetting, sender.Size.Height.ToString(CultureInfo.InvariantCulture));
    }

    private static Windows.Graphics.SizeInt32 LoadSavedSize()
    {
        if (int.TryParse(TraySettings.Read(WidthSetting), NumberStyles.Integer, CultureInfo.InvariantCulture, out var width) &&
            int.TryParse(TraySettings.Read(HeightSetting), NumberStyles.Integer, CultureInfo.InvariantCulture, out var height) &&
            width >= MinWidth && height >= MinHeight)
        {
            return new Windows.Graphics.SizeInt32(width, height);
        }

        return DefaultSize;
    }

    private void InitializeStyles()
    {
        var normalBrush = new SolidColorBrush(Color.FromArgb(255, 39, 39, 42));
        var hoverBrush = new SolidColorBrush(Color.FromArgb(255, 63, 63, 70));
        var selectedBrush = new SolidColorBrush(Color.FromArgb(255, 57, 135, 229));
        var foregroundBrush = new SolidColorBrush(Colors.White);

        ConfigurePeriodButton(Btn6h, normalBrush, hoverBrush, selectedBrush, foregroundBrush);
        ConfigurePeriodButton(Btn24h, normalBrush, hoverBrush, selectedBrush, foregroundBrush);
        ConfigurePeriodButton(Btn7d, normalBrush, hoverBrush, selectedBrush, foregroundBrush);
        ConfigurePeriodButton(Btn30d, normalBrush, hoverBrush, selectedBrush, foregroundBrush);
    }

    private static void ConfigurePeriodButton(
        Button button, SolidColorBrush normalBrush, SolidColorBrush hoverBrush,
        SolidColorBrush selectedBrush, SolidColorBrush foregroundBrush)
    {
        button.Background = normalBrush;
        button.Foreground = foregroundBrush;
        button.FontWeight = FontWeights.SemiBold;
        button.Padding = new Thickness(10, 6, 10, 6);
        button.BorderThickness = new Thickness(0);

        // Per-instance resource overrides: WinUI's default Button style pulls these keys via
        // {ThemeResource ...}, which walks up from the element's own Resources before the app
        // theme dictionaries - so this recolors pointer-over/pressed without a full style copy.
        button.Resources["ButtonBackgroundPointerOver"] = hoverBrush;
        button.Resources["ButtonBackgroundPressed"] = hoverBrush;
        button.Resources["ButtonBorderBrushPointerOver"] = hoverBrush;
        button.Resources["ButtonBorderBrushPressed"] = hoverBrush;
        button.Resources["SelectedBackgroundBrush"] = selectedBrush;
        button.Resources["NormalBackgroundBrush"] = normalBrush;
    }

    private void HookEvents()
    {
        Activated += HistoryWindow_Activated;

        QuotaCanvas.SizeChanged += ChartCanvas_SizeChanged;
        MemoryCanvas.SizeChanged += ChartCanvas_SizeChanged;
        SessionsCanvas.SizeChanged += ChartCanvas_SizeChanged;

        QuotaCanvas.PointerMoved += ChartCanvas_PointerMoved;
        MemoryCanvas.PointerMoved += ChartCanvas_PointerMoved;
        SessionsCanvas.PointerMoved += ChartCanvas_PointerMoved;

        QuotaCanvas.PointerExited += ChartCanvas_PointerExited;
        MemoryCanvas.PointerExited += ChartCanvas_PointerExited;
        SessionsCanvas.PointerExited += ChartCanvas_PointerExited;

        QuotaCanvas.PointerWheelChanged += ChartCanvas_PointerWheelChanged;
        MemoryCanvas.PointerWheelChanged += ChartCanvas_PointerWheelChanged;
        SessionsCanvas.PointerWheelChanged += ChartCanvas_PointerWheelChanged;

        TimeScrubberCanvas.SizeChanged += (_, _) => Redraw();
        TimeScrubberCanvas.PointerPressed += TimeScrubberCanvas_PointerPressed;
        TimeScrubberCanvas.PointerMoved += TimeScrubberCanvas_PointerMoved;
        TimeScrubberCanvas.PointerReleased += TimeScrubberCanvas_PointerReleased;
    }

    private void HistoryWindow_Activated(object sender, WindowActivatedEventArgs args)
    {
        if (args.WindowActivationState == WindowActivationState.Deactivated)
            return;

        Redraw();
    }

    private void ChartCanvas_SizeChanged(object sender, SizeChangedEventArgs e) => Redraw();

    private void PeriodButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button)
            return;

        _selectedPeriod = button switch
        {
            _ when ReferenceEquals(button, Btn6h) => TimeSpan.FromHours(6),
            _ when ReferenceEquals(button, Btn24h) => TimeSpan.FromHours(24),
            _ when ReferenceEquals(button, Btn7d) => TimeSpan.FromDays(7),
            _ when ReferenceEquals(button, Btn30d) => TimeSpan.FromDays(30),
            _ => _selectedPeriod,
        };

        SetSelectedPeriodButtonVisuals(button);
        Redraw();
    }

    private void SetSelectedPeriodButtonVisuals(Button selected)
    {
        SetButtonSelected(Btn6h, ReferenceEquals(selected, Btn6h));
        SetButtonSelected(Btn24h, ReferenceEquals(selected, Btn24h));
        SetButtonSelected(Btn7d, ReferenceEquals(selected, Btn7d));
        SetButtonSelected(Btn30d, ReferenceEquals(selected, Btn30d));
    }

    private static void SetButtonSelected(Button button, bool isSelected)
    {
        if (button.Resources["SelectedBackgroundBrush"] is SolidColorBrush selectedBrush &&
            button.Resources["NormalBackgroundBrush"] is SolidColorBrush normalBrush)
        {
            button.Background = isSelected ? selectedBrush : normalBrush;
        }
    }

    private void Redraw()
    {
        var now = DateTimeOffset.Now;

        // Loaded unfiltered: window-boundary and prediction math need to see samples outside
        // [_from, _to] too (an old reset anchor still projects forward correctly), and every
        // Draw*/SampleAt call below already filters to the visible range internally.
        _samples = UsageHistoryStore.Load(DateTimeOffset.MinValue);

        _to = _pinnedTo ?? now;
        _from = _to - _selectedPeriod;
        _viewTo = _pinnedTo is null ? ComputeLiveViewTo(_to) : _to;

        var predictAsOf = _pinnedTo is null ? now : (DateTimeOffset?)null;
        var predictions = UsageChartRenderer.DrawQuota(QuotaCanvas, _samples, _from, _to, _viewTo, predictAsOf);
        UsageChartRenderer.DrawMemory(MemoryCanvas, _samples, _from, _to, _viewTo);
        UsageChartRenderer.DrawSessions(SessionsCanvas, _samples, _from, _to, _viewTo);

        UpdatePredictionText(predictions);
        UpdateLiveCounters();
        UpdateTimeScrubber(now);
    }

    // The projection horizon as if we were live right now, regardless of whether we actually are -
    // stretched to the furthest window reset still ahead. Callers that mean "the axis as drawn"
    // gate this on _pinnedTo themselves (see Redraw); the scrubber deliberately does NOT, so its
    // ruler keeps a constant scale while dragging instead of rescaling the instant you land back
    // on "now" (see UpdateTimeScrubber/ScrubTo).
    private DateTimeOffset ComputeLiveViewTo(DateTimeOffset dataTo)
    {
        var viewTo = dataTo;
        viewTo = ExtendToLatestReset(viewTo, static s => s.FiveHourResetsAt);
        viewTo = ExtendToLatestReset(viewTo, static s => s.SevenDayResetsAt);
        viewTo = ExtendToLatestReset(viewTo, static s => s.SevenDaySonnetResetsAt);
        if (viewTo <= dataTo)
            return viewTo;

        // A little breathing room past the furthest reset, so its marker and dashed line land
        // with visible margin instead of sitting flush against the canvas edge.
        var futureSpan = viewTo - dataTo;
        var padding = TimeSpan.FromTicks((long)(futureSpan.Ticks * 0.08));
        if (padding < TimeSpan.FromMinutes(10))
            padding = TimeSpan.FromMinutes(10);
        return viewTo + padding;
    }

    private DateTimeOffset ExtendToLatestReset(DateTimeOffset current, Func<UsageSample, DateTimeOffset?> resetSelector)
    {
        for (var i = _samples.Count - 1; i >= 0; i--)
        {
            if (resetSelector(_samples[i]) is DateTimeOffset resetsAt)
                return resetsAt > current ? resetsAt : current;
        }

        return current;
    }

    private void UpdatePredictionText(IReadOnlyList<string> predictions)
    {
        PredictionText.Text = _pinnedTo is not null
            ? "Viewing history - jump to now for a live projection."
            : predictions.Count == 0
                ? "Not enough data yet for a projection."
                : string.Join("   ·   ", predictions);
    }

    // A compact readout of the current windows, independent of whatever period/scroll position
    // the charts below are showing - this always reflects the most recent poll.
    private void UpdateLiveCounters()
    {
        LiveCountersPanel.Children.Clear();

        UsageSample? latest = null;
        for (var i = _samples.Count - 1; i >= 0 && latest is null; i--)
        {
            if (_samples[i].FiveHour is not null || _samples[i].SevenDay is not null || _samples[i].SevenDaySonnet is not null)
                latest = _samples[i];
        }

        if (latest is null)
            return;

        AddCounterChip(LiveCountersPanel, "5h", latest.FiveHour, latest.FiveHourResetsAt, UsageChartRenderer.FiveHourColor);
        AddCounterChip(LiveCountersPanel, "7d", latest.SevenDay, latest.SevenDayResetsAt, UsageChartRenderer.SevenDayColor);
        AddCounterChip(LiveCountersPanel, "7d Sonnet", latest.SevenDaySonnet, latest.SevenDaySonnetResetsAt, UsageChartRenderer.SevenDaySonnetColor);

        if (latest.MemoryBytes is long memoryBytes)
        {
            var text = latest.SessionCount is int sessions
                ? $"{UsageFormat.Sessions(sessions)} · {UsageFormat.Bytes(memoryBytes)} RAM"
                : $"{UsageFormat.Bytes(memoryBytes)} RAM";

            LiveCountersPanel.Children.Add(new TextBlock
            {
                Text = text,
                FontSize = 12,
                Foreground = new SolidColorBrush(Color.FromArgb(255, 0xA1, 0xA1, 0xAA)),
                VerticalAlignment = VerticalAlignment.Center,
            });
        }
    }

    private static void AddCounterChip(StackPanel panel, string label, double? value, DateTimeOffset? resetsAt, Color seriesColor)
    {
        if (value is not double pct)
            return;

        var rounded = UsageFormat.Percent(pct);
        var remaining = UsageFormat.TimeRemaining(resetsAt);

        var chip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        chip.Children.Add(new Microsoft.UI.Xaml.Shapes.Ellipse
        {
            Width = 8,
            Height = 8,
            Fill = new SolidColorBrush(seriesColor),
            VerticalAlignment = VerticalAlignment.Center,
        });
        chip.Children.Add(new TextBlock
        {
            Text = remaining is null ? $"{label} {rounded}%" : $"{label} {rounded}% (resets {remaining})",
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            // Matches the dot instead of a separate severity colour - this chip already stands in
            // for the chart's legend, and a blue "7d" label next to an orange dot read as a
            // mismatch rather than a deliberate extra signal.
            Foreground = new SolidColorBrush(seriesColor),
            VerticalAlignment = VerticalAlignment.Center,
        });
        panel.Children.Add(chip);
    }

    private const double ScrubberMinBarWidth = 10;

    // Redraws the scrubber's track, data-availability shading and viewport bar to match whatever
    // history now exists and wherever [_from, _to] currently sits.
    private void UpdateTimeScrubber(DateTimeOffset now)
    {
        // Always present rather than popping in on scroll - a button that appears out of nowhere
        // reads as "something happened", where disabling it reads as "you're already there".
        NowButton.IsEnabled = _pinnedTo is not null;

        // The *live* horizon, not _viewTo (which shrinks to _to while pinned) - the ruler needs a
        // constant scale regardless of drag state, or it visibly rescales the instant a drag lands
        // back on "now" and _viewTo suddenly grows again. Only the viewport bar should move.
        var rangeEnd = LiveScrubberRangeEnd(now);
        DrawTimeScrubber(EarliestScrollableTo(now), now, rangeEnd);
    }

    private DateTimeOffset LiveScrubberRangeEnd(DateTimeOffset now)
    {
        var liveViewTo = ComputeLiveViewTo(now);
        return liveViewTo > now ? liveViewTo : now;
    }

    // rangeEnd is the live projection horizon, which can sit anywhere from minutes to a full 7
    // days past dataEnd depending on which window resets soonest. Mapping that linearly onto the
    // scrubber let a distant reset swallow almost the whole bar, squeezing the real, scrollable
    // history into a sliver against the left edge and making dataEnd's position jump around based
    // on reset timing alone. Cap how much width the projection can claim, same idea as the
    // charts' own broken axis: below the cap it still scales 1:1 (so it grows smoothly as a reset
    // approaches), above it extra distance costs no more width, so dataEnd stays put instead of
    // jumping. Shared by drawing (time -> x) and dragging (x -> time) so the two can't drift apart.
    private readonly record struct ScrubberScale(DateTimeOffset RangeStart, DateTimeOffset DataEnd, double HistoryWidth, double FutureStripWidth)
    {
        private double HistorySeconds => Math.Max(0, (DataEnd - RangeStart).TotalSeconds);

        public double XFor(DateTimeOffset t, double futureSeconds)
        {
            if (t <= DataEnd)
            {
                var seconds = HistorySeconds;
                return seconds <= 0 ? 0 : Math.Clamp((t - RangeStart).TotalSeconds / seconds, 0, 1) * HistoryWidth;
            }

            return futureSeconds <= 0
                ? HistoryWidth
                : HistoryWidth + Math.Clamp((t - DataEnd).TotalSeconds / futureSeconds, 0, 1) * FutureStripWidth;
        }

        public DateTimeOffset TimeFor(double x, double futureSeconds)
        {
            if (x <= HistoryWidth)
            {
                var seconds = HistorySeconds;
                var fraction = HistoryWidth <= 0 ? 0 : Math.Clamp(x / HistoryWidth, 0, 1);
                return RangeStart + TimeSpan.FromSeconds(seconds * fraction);
            }

            var futureFraction = FutureStripWidth <= 0 ? 0 : Math.Clamp((x - HistoryWidth) / FutureStripWidth, 0, 1);
            return DataEnd + TimeSpan.FromSeconds(futureSeconds * futureFraction);
        }
    }

    private const double MaxScrubberFutureStripPx = 40;

    private static ScrubberScale ComputeScrubberScale(DateTimeOffset rangeStart, DateTimeOffset dataEnd, DateTimeOffset rangeEnd, double width, out double futureSeconds)
    {
        var totalSeconds = (rangeEnd - rangeStart).TotalSeconds;
        futureSeconds = Math.Max(0, (rangeEnd - dataEnd).TotalSeconds);
        var uncompressedFutureWidth = totalSeconds <= 0 ? 0 : futureSeconds / totalSeconds * width;
        var futureStripWidth = Math.Min(uncompressedFutureWidth, MaxScrubberFutureStripPx);
        var historyWidth = Math.Max(1, width - futureStripWidth);
        return new ScrubberScale(rangeStart, dataEnd, historyWidth, futureStripWidth);
    }

    // The scrubber is a plain Canvas, not a Slider: a single dot doesn't communicate "this much
    // of history is currently on screen", so instead it's a draggable bar whose width mirrors how
    // wide a slice of the full scrollable range the charts above are showing. dataEnd separates
    // the real (scrollable, sample-backed) portion of the track from the projected sliver past it.
    private void DrawTimeScrubber(DateTimeOffset rangeStart, DateTimeOffset dataEnd, DateTimeOffset rangeEnd)
    {
        var canvas = TimeScrubberCanvas;
        canvas.Children.Clear();

        var width = canvas.ActualWidth;
        var height = canvas.ActualHeight;
        if (width < 4 || height <= 0 || rangeEnd <= rangeStart)
            return;

        var scale = ComputeScrubberScale(rangeStart, dataEnd, rangeEnd, width, out var futureSeconds);
        double XFor(DateTimeOffset t) => scale.XFor(t, futureSeconds);

        var dataX = XFor(dataEnd);

        canvas.Children.Add(new Microsoft.UI.Xaml.Shapes.Rectangle
        {
            Width = dataX,
            Height = height,
            RadiusX = height / 2,
            RadiusY = height / 2,
            Fill = new SolidColorBrush(Color.FromArgb(60, 161, 161, 170)),
        });

        if (rangeEnd > dataEnd)
        {
            // Fainter than the history track - it's not scrollable and there's nothing to show
            // availability for, just a hint that the charts' own projection extends this far.
            var future = new Microsoft.UI.Xaml.Shapes.Rectangle
            {
                Width = width - dataX,
                Height = height,
                RadiusX = height / 2,
                RadiusY = height / 2,
                Fill = new SolidColorBrush(Color.FromArgb(25, 161, 161, 170)),
            };
            canvas.Children.Add(future);
            Canvas.SetLeft(future, dataX);
        }

        DrawAvailabilitySegments(canvas, rangeStart, dataEnd, dataX, height);

        // Clamped to the track: a period wider than the available history (e.g. 30d picked
        // early on) would otherwise draw a bar that starts off the left edge.
        var barFrom = _from < rangeStart ? rangeStart : _from;
        var barToRaw = _pinnedTo is null ? _viewTo : _to;
        var barTo = barToRaw > rangeEnd ? rangeEnd : barToRaw;
        if (barTo < barFrom)
            barTo = barFrom;

        var barX = XFor(barFrom);
        var barWidth = Math.Max(ScrubberMinBarWidth, XFor(barTo) - barX);
        if (barX + barWidth > width)
            barX = width - barWidth;

        var bar = new Microsoft.UI.Xaml.Shapes.Rectangle
        {
            Width = barWidth,
            Height = height,
            RadiusX = height / 2,
            RadiusY = height / 2,
            Fill = new SolidColorBrush(Color.FromArgb(90, 57, 135, 229)),
            Stroke = new SolidColorBrush(Color.FromArgb(220, 57, 135, 229)),
            StrokeThickness = 1.5,
        };
        canvas.Children.Add(bar);
        Canvas.SetLeft(bar, barX);
        Canvas.SetTop(bar, 0);

        if (!_scrubberDragging)
            return;

        var label = new Border
        {
            Background = new SolidColorBrush(Color.FromArgb(230, 39, 39, 42)),
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(6, 2, 6, 2),
            Child = new TextBlock
            {
                Text = $"{_from.ToLocalTime():ddd d MMM HH:mm} → {_to.ToLocalTime():HH:mm}",
                FontSize = 11,
                Foreground = new SolidColorBrush(Colors.White),
            },
        };
        canvas.Children.Add(label);
        label.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
        var labelX = Math.Clamp(barX + barWidth / 2 - label.DesiredSize.Width / 2, 0, Math.Max(0, width - label.DesiredSize.Width));
        Canvas.SetLeft(label, labelX);
        Canvas.SetTop(label, -label.DesiredSize.Height - 4);
    }

    // A compact blue/grey minimap under the viewport bar: blue where a sample exists in that
    // slice of the scrollable range, grey where it doesn't - so scrubbing into silence (tray was
    // closed, or you've gone further back than history exists) reads as an expected gap.
    private void DrawAvailabilitySegments(Canvas canvas, DateTimeOffset rangeStart, DateTimeOffset rangeEnd, double width, double height)
    {
        const int buckets = 80;
        var span = rangeEnd - rangeStart;
        var bucketTicks = Math.Max(1, span.Ticks / buckets);
        var hasData = new bool[buckets];

        foreach (var sample in _samples)
        {
            if (sample.Timestamp < rangeStart || sample.Timestamp > rangeEnd)
                continue;

            var index = Math.Clamp((int)((sample.Timestamp - rangeStart).Ticks / bucketTicks), 0, buckets - 1);
            hasData[index] = true;
        }

        var bucketWidth = width / buckets;
        var fiveHour = UsageChartRenderer.FiveHourColor;
        var start = -1;

        for (var i = 0; i <= buckets; i++)
        {
            var filled = i < buckets && hasData[i];
            if (filled && start < 0)
            {
                start = i;
            }
            else if (!filled && start >= 0)
            {
                var bar = new Microsoft.UI.Xaml.Shapes.Rectangle
                {
                    Width = (i - start) * bucketWidth,
                    Height = height,
                    RadiusX = height / 2,
                    RadiusY = height / 2,
                    Fill = new SolidColorBrush(WithAlpha(fiveHour, 140)),
                };
                canvas.Children.Add(bar);
                Canvas.SetLeft(bar, start * bucketWidth);
                start = -1;
            }
        }
    }

    private static Color WithAlpha(Color color, byte alpha) => Color.FromArgb(alpha, color.R, color.G, color.B);

    private void TimeScrubberCanvas_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        _scrubberDragging = true;
        TimeScrubberCanvas.CapturePointer(e.Pointer);
        ScrubTo(e.GetCurrentPoint(TimeScrubberCanvas).Position.X);
    }

    private void TimeScrubberCanvas_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (_scrubberDragging)
            ScrubTo(e.GetCurrentPoint(TimeScrubberCanvas).Position.X);
    }

    private void TimeScrubberCanvas_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        _scrubberDragging = false;
        TimeScrubberCanvas.ReleasePointerCapture(e.Pointer);
        Redraw();
    }

    // Centers the viewport on whatever moment sits under the pointer - dragging anywhere on the
    // track (not just grabbing the bar precisely) pans the charts, same as a video scrubber.
    // Dropping into the future sliver just snaps to live - there's nothing to scroll to out there.
    private void ScrubTo(double pointerX)
    {
        var now = DateTimeOffset.Now;
        var rangeStart = EarliestScrollableTo(now);
        var rangeEnd = LiveScrubberRangeEnd(now);
        var width = TimeScrubberCanvas.ActualWidth;
        if (width < 1 || rangeEnd <= rangeStart)
            return;

        var scale = ComputeScrubberScale(rangeStart, now, rangeEnd, width, out var futureSeconds);
        var pointerTime = scale.TimeFor(Math.Clamp(pointerX, 0, width), futureSeconds);
        if (pointerTime > now)
            pointerTime = now;

        PinTo(pointerTime + TimeSpan.FromSeconds(_selectedPeriod.TotalSeconds / 2));
    }

    private void NowButton_Click(object sender, RoutedEventArgs e)
    {
        _pinnedTo = null;
        Redraw();
    }

    // Any mouse wheel notch over a chart scrubs the whole view by a fraction of the currently
    // selected period, in either direction - the fastest way to "look back a bit" without
    // reaching for the slider.
    private void ChartCanvas_PointerWheelChanged(object sender, PointerRoutedEventArgs e)
    {
        var delta = e.GetCurrentPoint((UIElement)sender).Properties.MouseWheelDelta;
        if (delta == 0)
            return;

        var step = TimeSpan.FromSeconds(_selectedPeriod.TotalSeconds * 0.15) * Math.Sign(delta);
        PinTo((_pinnedTo ?? DateTimeOffset.Now) + step);
        e.Handled = true;
    }

    private void PinTo(DateTimeOffset target)
    {
        var now = DateTimeOffset.Now;
        var minTo = EarliestScrollableTo(now);

        // Snapping back to "now" (or having too little history to scroll at all) clears the pin
        // outright, rather than pinning to a value that happens to equal now - that would leave
        // the "jump to now" button showing even though the view is already live.
        _pinnedTo = target >= now || minTo >= now ? null : target < minTo ? minTo : target;

        Redraw();
    }

    // The oldest right-edge worth scrolling to. Deliberately just the earliest sample itself,
    // not "earliest + one full period" - requiring a full period of history before allowing any
    // scroll at all meant a freshly-started history (or a 7d/30d period picked early on) couldn't
    // be scrolled at all, which read as "scrolling doesn't work".
    private DateTimeOffset EarliestScrollableTo(DateTimeOffset now)
    {
        var earliest = _samples.Count > 0 ? _samples[0].Timestamp : now;
        return earliest > now ? now : earliest;
    }

    private void ChartCanvas_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (sender is not Canvas sourceCanvas)
            return;

        var pointerX = e.GetCurrentPoint(sourceCanvas).Position.X;

        // Crosshair mirrors across all three panels: they share one x-axis (time) and, in this
        // layout, one width, so a single pointerX lines up in each.
        UsageChartRenderer.DrawCrosshair(QuotaOverlay, _samples, _from, _to, _viewTo, pointerX);
        UsageChartRenderer.DrawCrosshair(MemoryOverlay, _samples, _from, _to, _viewTo, pointerX);
        UsageChartRenderer.DrawCrosshair(SessionsOverlay, _samples, _from, _to, _viewTo, pointerX);

        var sample = UsageChartRenderer.SampleAt(_samples, _from, _to, _viewTo, pointerX, sourceCanvas.ActualWidth);
        ReadoutText.Text = sample is null ? IdleReadout : BuildReadout(sample);
    }

    private void ChartCanvas_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        UsageChartRenderer.DrawCrosshair(QuotaOverlay, _samples, _from, _to, _viewTo, double.MinValue);
        UsageChartRenderer.DrawCrosshair(MemoryOverlay, _samples, _from, _to, _viewTo, double.MinValue);
        UsageChartRenderer.DrawCrosshair(SessionsOverlay, _samples, _from, _to, _viewTo, double.MinValue);
        ReadoutText.Text = IdleReadout;
    }

    private static string BuildReadout(UsageSample sample)
    {
        var parts = new List<string> { sample.Timestamp.ToLocalTime().ToString("HH:mm") };

        if (sample.FiveHour is double fiveHour) parts.Add($"5h {Math.Round(fiveHour):0}%");
        if (sample.SevenDay is double sevenDay) parts.Add($"7d {Math.Round(sevenDay):0}%");
        if (sample.SevenDaySonnet is double sonnet) parts.Add($"7d Sonnet {Math.Round(sonnet):0}%");
        if (sample.SessionCount is int sessions) parts.Add(UsageFormat.Sessions(sessions));
        if (sample.MemoryBytes is long memory) parts.Add($"{UsageFormat.Bytes(memory)} RAM");

        return string.Join(" · ", parts);
    }

    // Drawn once at startup rather than shipped as a static .ico: a tiny ascending bar chart in
    // the exact three colours the charts below it use, so the title bar previews the window's
    // own content instead of carrying a generic default icon.
    private static Icon CreateWindowIcon()
    {
        using var bitmap = new Bitmap(64, 64);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;

        using (var backdropPath = RoundedRectPath(new Rectangle(0, 0, 64, 64), 14))
        using (var backdropBrush = new SolidBrush(System.Drawing.Color.FromArgb(255, 39, 39, 42)))
        {
            graphics.FillPath(backdropBrush, backdropPath);
        }

        DrawTopRoundedBar(graphics, 14, 32, 10, 50, 3, UsageChartRenderer.FiveHourColor);
        DrawTopRoundedBar(graphics, 27, 22, 10, 50, 3, UsageChartRenderer.SevenDayColor);
        DrawTopRoundedBar(graphics, 40, 14, 10, 50, 3, UsageChartRenderer.SevenDaySonnetColor);

        // Icon.FromHandle doesn't take ownership of the HICON, so nothing here destroys it - the
        // handle is meant to live for as long as this one field does, which is the app's lifetime.
        return Icon.FromHandle(bitmap.GetHicon());

        static GraphicsPath RoundedRectPath(Rectangle rect, int radius)
        {
            var path = new GraphicsPath();
            var diameter = radius * 2;
            path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        static void DrawTopRoundedBar(Graphics graphics, int x, int top, int width, int baselineY, int radius, Windows.UI.Color color)
        {
            using var path = new GraphicsPath();
            var diameter = radius * 2;
            var right = x + width;
            path.AddArc(x, top, diameter, diameter, 180, 90);
            path.AddArc(right - diameter, top, diameter, diameter, 270, 90);
            path.AddLine(right, top + radius, right, baselineY);
            path.AddLine(right, baselineY, x, baselineY);
            path.AddLine(x, baselineY, x, top + radius);
            path.CloseFigure();

            using var brush = new SolidBrush(System.Drawing.Color.FromArgb(color.A, color.R, color.G, color.B));
            graphics.FillPath(brush, path);
        }
    }
}
