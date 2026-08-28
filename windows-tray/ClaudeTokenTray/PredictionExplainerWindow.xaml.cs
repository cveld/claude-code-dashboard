using System.Globalization;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.Graphics;
using Windows.UI;

namespace ClaudeTokenTray;

// A small, reusable window that answers "why does this projection land where it does" for
// whichever series' live-counter chip or chart marker the user clicked in HistoryWindow - a
// compact redraw of just that one series' observed-to-projected line, plus the same
// plain-language sentence already shown under the main quota chart. Built once and hidden (not
// destroyed) on close, same lifetime pattern as HistoryWindow itself, since it's cheap to keep
// around and clicks on the explainer are expected to repeat across a session.
public sealed partial class PredictionExplainerWindow : Window
{
    // AppWindow.Resize sets the *outer* window size, title bar included - the Grid inside only
    // gets what's left after that. 380 tall leaves comfortable room for a header that wraps to two
    // lines plus a sentence that wraps to two, on top of the chart's own MinHeight; a fixed,
    // non-resizable window at the old 300 clipped the sentence off the bottom whenever either did.
    private static readonly SizeInt32 WindowSize = new(480, 380);
    private const int MinWidth = 400;
    private const int MinHeight = 320;

    private UsageChartRenderer.PredictionMarker? _marker;

    public PredictionExplainerWindow()
    {
        InitializeComponent();

        AppWindow.Resize(WindowSize);
        CenterOnScreen();
        if (AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.IsMaximizable = false;
            presenter.PreferredMinimumWidth = MinWidth;
            presenter.PreferredMinimumHeight = MinHeight;
        }

        AppWindow.Closing += (_, args) =>
        {
            args.Cancel = true;
            AppWindow.Hide();
        };
    }

    private void CenterOnScreen()
    {
        var displayArea = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary);
        var work = displayArea.WorkArea;
        AppWindow.Move(new PointInt32(
            work.X + (work.Width - WindowSize.Width) / 2,
            work.Y + (work.Height - WindowSize.Height) / 2));
    }

    public void Show(UsageChartRenderer.PredictionMarker marker)
    {
        _marker = marker;
        Title = $"{marker.Label} projection";
        HeaderText.Text = $"{marker.Label}: why the projection lands where it does";
        SentenceText.Text = marker.Sentence;
        DrawChart(marker);

        AppWindow.Show();
        Activate();
    }

    // Redraws on layout change too - the canvas has no size yet the first time Show() runs (the
    // window hasn't been shown/measured before), so the very first draw happens here instead.
    private void DetailCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_marker is UsageChartRenderer.PredictionMarker marker)
            DrawChart(marker);
    }

    private void DrawChart(UsageChartRenderer.PredictionMarker marker)
    {
        DetailCanvas.Children.Clear();

        var width = DetailCanvas.ActualWidth;
        var height = DetailCanvas.ActualHeight;
        if (width < 60 || height < 60)
            return;

        const double leftGutter = 34, rightInset = 10, topInset = 10, bottomInset = 24;
        var plotLeft = leftGutter;
        var plotRight = Math.Max(leftGutter + 1, width - rightInset);
        var plotTop = topInset;
        var plotBottom = Math.Max(topInset + 1, height - bottomInset);

        // The right edge is always the window's actual reset, even when the projection itself
        // lands earlier (crosses 100% before reset) - otherwise the chart would silently crop off
        // the "still time left after this" story the reset dot below exists to tell.
        var xStart = marker.FirstTime;
        var xEnd = marker.ResetAt > xStart ? marker.ResetAt : marker.Time2 > xStart ? marker.Time2 : xStart + TimeSpan.FromMinutes(1);
        var totalSeconds = Math.Max(1, (xEnd - xStart).TotalSeconds);

        double XFor(DateTimeOffset t) => plotLeft + (t - xStart).TotalSeconds / totalSeconds * (plotRight - plotLeft);
        double YFor(double pct) => plotTop + (100 - Math.Clamp(pct, 0, 100)) / 100.0 * (plotBottom - plotTop);

        var gridBrush = new SolidColorBrush(Color.FromArgb(40, 255, 255, 255));
        var emphasisGridBrush = new SolidColorBrush(Color.FromArgb(90, 255, 255, 255));
        var labelBrush = new SolidColorBrush(Color.FromArgb(150, 255, 255, 255));
        var seriesBrush = new SolidColorBrush(marker.Color);

        void AddLine(Point from, Point to, Brush stroke, double thickness, bool dashed = false)
        {
            var line = new Line { X1 = from.X, Y1 = from.Y, X2 = to.X, Y2 = to.Y, Stroke = stroke, StrokeThickness = thickness };
            if (dashed)
                line.StrokeDashArray = [5, 3];
            DetailCanvas.Children.Add(line);
        }

        void AddDot(Point at, double diameter, bool hollow = false)
        {
            var dot = new Ellipse
            {
                Width = diameter,
                Height = diameter,
                Fill = hollow ? new SolidColorBrush(Microsoft.UI.Colors.Transparent) : seriesBrush,
                Stroke = hollow ? seriesBrush : null,
                StrokeThickness = hollow ? 1.5 : 0,
            };
            DetailCanvas.Children.Add(dot);
            Canvas.SetLeft(dot, at.X - diameter / 2);
            Canvas.SetTop(dot, at.Y - diameter / 2);
        }

        void AddLabel(string text, double centerX, double y, Brush brush)
        {
            var label = new TextBlock { Text = text, FontSize = 10, Foreground = brush };
            DetailCanvas.Children.Add(label);
            label.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            Canvas.SetLeft(label, Math.Clamp(centerX - label.DesiredSize.Width / 2, 0, Math.Max(0, width - label.DesiredSize.Width)));
            Canvas.SetTop(label, y);
        }

        // A point label sits above its dot by default (out of the way of the lines below it), but
        // flips underneath when the dot is close enough to the top that "above" would run off the
        // plot - e.g. a projection that's already near 100%.
        void AddPointLabel(string text, Point at, Brush brush)
        {
            const double labelHeight = 13;
            var y = at.Y - labelHeight - 4 >= plotTop ? at.Y - labelHeight - 4 : at.Y + 6;
            AddLabel(text, at.X, y, brush);
        }

        // Gridlines + y-axis labels at 0/50/100%.
        foreach (var pct in new[] { 0.0, 50.0, 100.0 })
        {
            var y = YFor(pct);
            AddLine(new Point(plotLeft, y), new Point(plotRight, y), pct >= 100 ? emphasisGridBrush : gridBrush, 1, dashed: pct < 100);
            AddLabel($"{pct:0}%", 0, y - 6, labelBrush);
        }

        // Date/time ticks along the bottom, same adaptive format as the main quota chart's own
        // time axis (UsageChartRenderer.DrawTimeAxis) - hours when the window's short, weekday +
        // time or a bare date once it stretches toward a week, so a 7d window reads as actual
        // calendar days rather than just two isolated "now"/"reset" instants.
        var axisFormat = totalSeconds < TimeSpan.FromHours(36).TotalSeconds
            ? "HH:mm"
            : totalSeconds <= TimeSpan.FromDays(8).TotalSeconds ? "ddd HH:mm" : "dd MMM";
        const int axisTicks = 5;
        for (var i = 0; i < axisTicks; i++)
        {
            var fraction = i / (double)(axisTicks - 1);
            var at = xStart + TimeSpan.FromSeconds(totalSeconds * fraction);
            var x = plotLeft + fraction * (plotRight - plotLeft);
            AddLine(new Point(x, plotBottom), new Point(x, plotBottom + 3), gridBrush, 1);
            AddLabel(at.ToLocalTime().ToString(axisFormat, CultureInfo.CurrentCulture), x, plotBottom + 5, labelBrush);
        }

        var firstPoint = new Point(XFor(marker.FirstTime), YFor(marker.FirstValue));
        var nowPoint = new Point(XFor(marker.Time1), YFor(marker.Value1));
        var targetPoint = new Point(XFor(marker.Time2), YFor(marker.Value2));

        // Observed: what the fitted line was actually built from.
        AddLine(firstPoint, nowPoint, seriesBrush, 2.5);
        AddDot(nowPoint, 6);
        AddPointLabel("now", nowPoint, labelBrush);

        // Projected: the same straight line, continued from "now" to where it lands.
        AddLine(nowPoint, targetPoint, seriesBrush, 2, dashed: true);
        AddDot(targetPoint, 8, hollow: true);

        // When the projection crosses 100% before the actual reset, a second filled dot at the
        // reset's own x (same row as the target) shows the window keeps running past that point
        // rather than stopping dead - mirrors the hollow/filled pair on the main quota chart.
        if (marker.ResetAt - marker.Time2 > TimeSpan.FromMinutes(1))
        {
            var resetPoint = new Point(XFor(marker.ResetAt), targetPoint.Y);
            AddDot(resetPoint, 5);
            AddPointLabel($"reset {marker.ResetAt.ToLocalTime():HH:mm}", resetPoint, labelBrush);
        }
        else
        {
            AddPointLabel($"reset {marker.ResetAt.ToLocalTime():HH:mm}", targetPoint, labelBrush);
        }
    }
}
