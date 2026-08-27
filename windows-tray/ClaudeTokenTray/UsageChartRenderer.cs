using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using Windows.UI;

namespace ClaudeTokenTray;

// Draws the usage-history charts as plain WinUI shapes on a Canvas - no charting package.
// All three panels share one x-axis (time) and each keeps its own y-axis in its own panel;
// quota %, RAM and session count are never squeezed onto a second y-scale in one plot.
public static class UsageChartRenderer
{
    // Categorical slots 1-3 of the dashboard palette, stepped for a dark surface. Validated as a
    // set against #18181b: lightness band, chroma floor, CVD separation and 3:1 contrast all pass.
    public static readonly Color FiveHourColor = Color.FromArgb(0xFF, 0x39, 0x87, 0xE5);
    public static readonly Color SevenDayColor = Color.FromArgb(0xFF, 0xD9, 0x59, 0x26);
    public static readonly Color SevenDaySonnetColor = Color.FromArgb(0xFF, 0x19, 0x9E, 0x70);

    // Single-series panels use neutral ink instead of a categorical hue: their identity comes
    // from the panel title, and borrowing a series colour would imply a relation that isn't there.
    // The Memory panel is the one exception now that it plots two series (RAM + paged) - RAM keeps
    // this neutral ink since it's still the primary reading (matches the tray icon/tooltip), and
    // paged gets its own distinct hue so the two don't read as one blurred line.
    public static readonly Color MemoryColor = Color.FromArgb(0xFF, 0xD4, 0xD4, 0xD8);
    public static readonly Color PagedMemoryColor = Color.FromArgb(0xFF, 0xA7, 0x8B, 0xFA);
    private static readonly Color SessionsColor = Color.FromArgb(0xFF, 0x71, 0x71, 0x7A);
    private static readonly Color WarnColor = Color.FromArgb(0xFF, 0xE6, 0x67, 0x67);

    private const double LeftGutter = 46;
    private const double RightInset = 10;
    private const double TopInset = 10;
    private const double BottomInset = 22;
    private const int MaxBuckets = 180;
    private const int GridLines = 5;

    private static readonly TimeSpan MinBucketWidth = TimeSpan.FromMinutes(5);

    // A trend needs enough spread to mean anything - two samples five minutes apart would
    // extrapolate wildly on noise alone.
    private static readonly TimeSpan MinTrendSpan = TimeSpan.FromMinutes(15);

    // ~1cm at 96 DPI: how much horizontal room the future/projection stretch is allowed before
    // it starts crowding out the actual history. Past that, PlotRect compresses it into a fixed
    // strip instead of scaling it 1:1 with time, same idea as a broken axis.
    private const double FutureStripWidthPx = 40;
    private const double BreakGapWidthPx = 16;

    private static readonly TimeSpan SevenDayPeriod = TimeSpan.FromDays(7);
    private static readonly TimeSpan ThirtyDayPeriod = TimeSpan.FromDays(30);

    public static IReadOnlyList<string> DrawQuota(
        Canvas canvas, IReadOnlyList<UsageSample> samples, DateTimeOffset from, DateTimeOffset to, DateTimeOffset viewTo, DateTimeOffset? predictAsOf,
        TimeSpan selectedPeriod, out IReadOnlyList<PredictionMarker> predictionMarkers)
    {
        canvas.Children.Clear();
        predictionMarkers = [];
        if (!TryGetPlotRect(canvas, from, to, viewTo, out var plot))
            return [];

        var buckets = Bucketize(samples, from, to);
        if (!buckets.Any(b => b.FiveHour is not null || b.SevenDay is not null || b.SevenDaySonnet is not null))
        {
            DrawEmptyState(canvas, EmptyStateMessage(samples));
            return [];
        }

        DrawGrid(canvas, plot, 100, v => $"{v:0}%");
        DrawTimeAxis(canvas, plot);

        // "now", "90%" and every series' start/reset tag all want to sit near the top of the
        // chart and often land close together on the x-axis (especially live, where "now" and an
        // imminent reset can be only a few pixels apart) - sharing one layout across all of them
        // lets it stack whichever ones collide instead of drawing straight through each other.
        var topLabels = new TopLabelLayout();
        DrawNowMarker(canvas, plot, to, topLabels);
        DrawAxisBreak(canvas, plot);

        // Each window's start is resetsAt minus its own fixed length - a hard fact straight from
        // the API's own data (not an assumption about how cycles chain together), and unlike
        // walking back through polled samples it can't be thrown off by a gap in polling (sleep,
        // app not running, ...) that straddles the real rollover. Windows also aren't guaranteed
        // to butt up against each other - an idle account doesn't start a new window the instant
        // the old one ends, only on its next actual usage - so every completed window's own end
        // (that's the *previous* reset value itself, reported directly) is drawn too; a visible
        // gap between one window's end and the next one's start is a real, observed idle period,
        // not a rendering artifact. Both 5h and 7d keep their own *upcoming* reset off
        // (drawUpcoming: false, only relevant for the current still-running window) - between the
        // live counters row, the axis stretching out to meet it, and `AddPrediction`'s own hollow
        // marker already sitting right where that reset lands, the extra dashed "X reset" line +
        // label was redundant clutter rather than new information.
        // At the 7d zoom, a week of 5h resets packs in every few pixels - drawn at full weight
        // they'd compete with the 7d/7d-Sonnet lines that actually matter at that zoom, so they're
        // thinned instead. At 30d there'd be dozens of them with no room to even show a gap between
        // resets, so they're dropped entirely rather than rendering as a solid smear.
        var fiveHourThickness = selectedPeriod >= ThirtyDayPeriod ? 0 : selectedPeriod >= SevenDayPeriod ? 0.75 : 1.5;
        if (fiveHourThickness > 0)
            DrawWindowBoundaries(canvas, plot, samples, static s => s.FiveHourResetsAt, FiveHourColor, "5h", TimeSpan.FromHours(5), drawUpcoming: false, topLabels, fiveHourThickness);
        DrawWindowBoundaries(canvas, plot, samples, static s => s.SevenDayResetsAt, SevenDayColor, "7d", TimeSpan.FromDays(7), drawUpcoming: false, topLabels);
        DrawWindowBoundaries(canvas, plot, samples, static s => s.SevenDaySonnetResetsAt, SevenDaySonnetColor, "7d Sonnet", TimeSpan.FromDays(7), drawUpcoming: true, topLabels);

        DrawWarnLine(canvas, plot, topLabels);

        // 5h drawn last so the window the user watches most ends up on top.
        DrawLineSeries(canvas, plot, buckets, static b => b.SevenDaySonnet, 100, SevenDaySonnetColor, "7d Sonnet");
        DrawLineSeries(canvas, plot, buckets, static b => b.SevenDay, 100, SevenDayColor, "7d");
        DrawLineSeries(canvas, plot, buckets, static b => b.FiveHour, 100, FiveHourColor, "5h");

        var predictions = new List<string>();
        var markers = new List<PredictionMarker>();
        if (predictAsOf is DateTimeOffset now)
        {
            AddPrediction(predictions, markers, canvas, plot, samples, "5h", FiveHourColor, static s => s.FiveHour, static s => s.FiveHourResetsAt, now);
            AddPrediction(predictions, markers, canvas, plot, samples, "7d", SevenDayColor, static s => s.SevenDay, static s => s.SevenDayResetsAt, now);
            AddPrediction(predictions, markers, canvas, plot, samples, "7d Sonnet", SevenDaySonnetColor, static s => s.SevenDaySonnet, static s => s.SevenDaySonnetResetsAt, now);
        }

        predictionMarkers = markers;
        return predictions;
    }

    // A prediction's dashed line reduced to what a pointer-hover readout needs: its two pixel-space
    // endpoints and the time/value they represent. Both time and value are interpolated by the
    // same x-fraction along that straight pixel-space line - not by re-deriving a "true" time from
    // x - so the reported time can never disagree with where the line is actually drawn, even once
    // the axis break bends the underlying time scale.
    public readonly record struct PredictionMarker(string Label, Color Color, double X1, DateTimeOffset Time1, double Value1, double X2, DateTimeOffset Time2, double Value2)
    {
        public (DateTimeOffset Time, double Value)? At(double x)
        {
            var lo = Math.Min(X1, X2);
            var hi = Math.Max(X1, X2);
            if (x < lo || x > hi || hi - lo < 1e-6)
                return null;

            var t = (x - X1) / (X2 - X1);
            var time = Time1 + TimeSpan.FromTicks((long)((Time2 - Time1).Ticks * t));
            var value = Value1 + t * (Value2 - Value1);
            return (time, value);
        }
    }

    public static void DrawMemory(Canvas canvas, IReadOnlyList<UsageSample> samples, DateTimeOffset from, DateTimeOffset to, DateTimeOffset viewTo)
    {
        canvas.Children.Clear();
        if (!TryGetPlotRect(canvas, from, to, viewTo, out var plot))
            return;

        var buckets = Bucketize(samples, from, to);
        if (buckets.All(b => b.MemoryBytes is null && b.PagedMemoryBytes is null))
        {
            DrawEmptyState(canvas, EmptyStateMessage(samples));
            return;
        }

        var maxGb = Math.Max(
            buckets.Max(b => ToGigabytes(b.MemoryBytes) ?? 0),
            buckets.Max(b => ToGigabytes(b.PagedMemoryBytes) ?? 0));
        var yMax = Math.Max(1, Math.Ceiling(maxGb * 1.25));
        DrawGrid(canvas, plot, yMax, v => $"{v:0.#} GB");
        DrawTimeAxis(canvas, plot);
        DrawNowMarker(canvas, plot, to, new TopLabelLayout());
        DrawAxisBreak(canvas, plot);

        // Paged drawn first (dashed, no fill) so RAM's filled area sits on top of it rather than
        // the reverse - RAM is the primary reading (it's what the tray icon/tooltip show), paged
        // is the supplementary one and shouldn't visually compete with it.
        foreach (var segment in BuildSegments(buckets, static b => ToGigabytes(b.PagedMemoryBytes), plot, yMax))
        {
            if (segment.Count == 1)
                AddDot(canvas, segment[0], PagedMemoryColor);
            else
                canvas.Children.Add(NewPolyline(segment, PagedMemoryColor, dashed: true));
        }

        foreach (var segment in BuildSegments(buckets, static b => ToGigabytes(b.MemoryBytes), plot, yMax))
        {
            if (segment.Count == 1)
            {
                AddDot(canvas, segment[0], MemoryColor);
                continue;
            }

            var area = new Polygon { Fill = new SolidColorBrush(WithAlpha(MemoryColor, 38)) };
            foreach (var point in segment)
                area.Points.Add(point);
            area.Points.Add(new Point(segment[^1].X, plot.Bottom));
            area.Points.Add(new Point(segment[0].X, plot.Bottom));
            canvas.Children.Add(area);

            canvas.Children.Add(NewPolyline(segment, MemoryColor));
        }
    }

    public static void DrawSessions(Canvas canvas, IReadOnlyList<UsageSample> samples, DateTimeOffset from, DateTimeOffset to, DateTimeOffset viewTo)
    {
        canvas.Children.Clear();
        if (!TryGetPlotRect(canvas, from, to, viewTo, out var plot))
            return;

        var buckets = Bucketize(samples, from, to);
        if (buckets.All(b => b.SessionCount is null))
        {
            DrawEmptyState(canvas, EmptyStateMessage(samples));
            return;
        }

        // Integer scale: pick a step so every gridline lands on a whole session count.
        var maxSessions = buckets.Max(b => b.SessionCount ?? 0);
        var step = Math.Max(1, (int)Math.Ceiling(Math.Max(1, maxSessions) / (double)(GridLines - 1)));
        var yMax = step * (GridLines - 1);

        DrawGrid(canvas, plot, yMax, v => $"{v:0}");
        DrawTimeAxis(canvas, plot);
        DrawNowMarker(canvas, plot, to, new TopLabelLayout());
        DrawAxisBreak(canvas, plot);

        // 2px of surface between neighbouring bars keeps them readable as separate marks.
        var barWidth = Math.Max(1, plot.Width / buckets.Count - 2);
        var brush = new SolidColorBrush(SessionsColor);

        foreach (var bucket in buckets)
        {
            if (bucket.SessionCount is not int count || count <= 0)
                continue;

            var y = plot.YFor(count, yMax);
            var height = plot.Bottom - y;
            if (height < 1)
                height = 1;

            var bar = new Rectangle
            {
                Width = barWidth,
                Height = height,
                RadiusX = 2,
                RadiusY = 2,
                Fill = brush,
            };
            canvas.Children.Add(bar);
            Canvas.SetLeft(bar, plot.XFor(bucket.Center) - barWidth / 2);
            Canvas.SetTop(bar, y);
        }
    }

    // Vertical guide at the hovered bucket, drawn on a canvas layered over a chart. The caller
    // renders the value readout itself (see HistoryWindow), so this stays text-free.
    public static void DrawCrosshair(Canvas overlay, IReadOnlyList<UsageSample> samples, DateTimeOffset from, DateTimeOffset to, DateTimeOffset viewTo, double pointerX)
    {
        overlay.Children.Clear();
        if (!TryGetPlotRect(overlay, from, to, viewTo, out var plot) || pointerX < plot.X || pointerX > plot.Right)
            return;

        var buckets = Bucketize(samples, from, to);
        var bucket = NearestBucket(buckets, plot, pointerX);
        if (bucket is null)
            return;

        overlay.Children.Add(new Line
        {
            X1 = plot.XFor(bucket.Center),
            X2 = plot.XFor(bucket.Center),
            Y1 = 0,
            Y2 = overlay.ActualHeight,
            Stroke = new SolidColorBrush(Color.FromArgb(90, 255, 255, 255)),
            StrokeThickness = 1,
        });
    }

    // The bucket nearest the pointer, as a sample, for the hover readout. Shares PlotRect with
    // the Draw* methods so the crosshair and the value it reports can't drift apart.
    public static UsageSample? SampleAt(IReadOnlyList<UsageSample> samples, DateTimeOffset from, DateTimeOffset to, DateTimeOffset viewTo, double pointerX, double canvasWidth)
    {
        if (canvasWidth < 80 || viewTo <= from)
            return null;

        var plot = GetPlotRect(canvasWidth, 100, from, to, viewTo);
        if (pointerX < plot.X || pointerX > plot.Right)
            return null;

        var bucket = NearestBucket(Bucketize(samples, from, to), plot, pointerX);
        return bucket is null
            ? null
            : new UsageSample(bucket.Center, bucket.FiveHour, bucket.SevenDay, bucket.SevenDaySonnet,
                bucket.MemoryBytes, bucket.PagedMemoryBytes, bucket.SessionCount);
    }

    private static void DrawLineSeries(Canvas canvas, PlotRect plot, List<Bucket> buckets,
        Func<Bucket, double?> selector, double yMax, Color color, string endLabel)
    {
        Point? lastPoint = null;

        foreach (var segment in BuildSegments(buckets, selector, plot, yMax))
        {
            if (segment.Count == 1)
                AddDot(canvas, segment[0], color);
            else
                canvas.Children.Add(NewPolyline(segment, color));

            lastPoint = segment[^1];
        }

        if (lastPoint is not Point anchor)
            return;

        // Direct label at the end of the line, so identity never rests on colour alone.
        var label = new TextBlock
        {
            Text = endLabel,
            FontSize = 10,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(color),
        };
        canvas.Children.Add(label);
        label.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));

        var x = anchor.X + 6;
        if (x + label.DesiredSize.Width > plot.Right)
            x = anchor.X - label.DesiredSize.Width - 6;

        Canvas.SetLeft(label, x);
        Canvas.SetTop(label, Math.Max(0, anchor.Y - 8 - label.DesiredSize.Height / 2));
    }

    // Splits the buckets into runs of contiguous data. A stretch where the tray wasn't running
    // becomes a break in the line instead of a straight segment that fakes readings.
    private static List<List<Point>> BuildSegments(List<Bucket> buckets, Func<Bucket, double?> selector, PlotRect plot, double yMax)
    {
        var segments = new List<List<Point>>();
        if (buckets.Count == 0)
            return segments;

        var bucketWidth = buckets.Count > 1 ? buckets[1].Center - buckets[0].Center : MinBucketWidth;
        var gapThreshold = Max(bucketWidth * 3, TimeSpan.FromMinutes(20));

        List<Point>? current = null;
        DateTimeOffset? previous = null;

        foreach (var bucket in buckets)
        {
            if (selector(bucket) is not double value)
                continue;

            if (previous is DateTimeOffset last && bucket.Center - last > gapThreshold)
            {
                if (current is { Count: > 0 })
                    segments.Add(current);
                current = null;
            }

            current ??= [];
            current.Add(new Point(plot.XFor(bucket.Center), plot.YFor(value, yMax)));
            previous = bucket.Center;
        }

        if (current is { Count: > 0 })
            segments.Add(current);

        return segments;
    }

    // Downsamples to at most MaxBuckets points, taking the maximum per bucket: for quota windows
    // the peak is what matters (did it approach the ceiling), not the average.
    private static List<Bucket> Bucketize(IReadOnlyList<UsageSample> samples, DateTimeOffset from, DateTimeOffset to)
    {
        var span = to - from;
        if (span <= TimeSpan.Zero)
            return [];

        var width = TimeSpan.FromTicks(Math.Max(span.Ticks / MaxBuckets, MinBucketWidth.Ticks));
        var count = Math.Max(1, (int)Math.Ceiling(span.Ticks / (double)width.Ticks));

        var buckets = new List<Bucket>(count);
        for (var i = 0; i < count; i++)
            buckets.Add(new Bucket(from + TimeSpan.FromTicks(width.Ticks * i + width.Ticks / 2)));

        foreach (var sample in samples)
        {
            if (sample.Timestamp < from || sample.Timestamp > to)
                continue;

            var index = Math.Clamp((int)((sample.Timestamp - from).Ticks / width.Ticks), 0, count - 1);
            buckets[index].Add(sample);
        }

        return buckets;
    }

    private static Bucket? NearestBucket(List<Bucket> buckets, PlotRect plot, double pointerX)
    {
        Bucket? nearest = null;
        var bestDistance = double.MaxValue;

        foreach (var bucket in buckets)
        {
            if (!bucket.HasData)
                continue;

            var distance = Math.Abs(plot.XFor(bucket.Center) - pointerX);
            if (distance < bestDistance)
            {
                bestDistance = distance;
                nearest = bucket;
            }
        }

        return nearest;
    }

    private static void DrawGrid(Canvas canvas, PlotRect plot, double yMax, Func<double, string> format)
    {
        for (var i = 0; i < GridLines; i++)
        {
            var fraction = i / (double)(GridLines - 1);
            var y = plot.Y + plot.Height * fraction;

            canvas.Children.Add(new Line
            {
                X1 = plot.X,
                X2 = plot.Right,
                Y1 = y,
                Y2 = y,
                Stroke = new SolidColorBrush(Color.FromArgb(22, 255, 255, 255)),
                StrokeThickness = 1,
            });

            var label = new TextBlock
            {
                Text = format(yMax * (1 - fraction)),
                Width = LeftGutter - 6,
                TextAlignment = TextAlignment.Right,
                FontSize = 10,
                Foreground = new SolidColorBrush(Color.FromArgb(140, 255, 255, 255)),
            };
            canvas.Children.Add(label);
            Canvas.SetLeft(label, 0);
            Canvas.SetTop(label, y - 7);
        }
    }

    // Ticked across [From, DataTo] only, even when the axis stretches further for a live
    // projection - an evenly-time-spaced tick set would otherwise cluster inside the (often much
    // longer) future stretch and leave none over the history the user actually asked to see.
    private static void DrawTimeAxis(Canvas canvas, PlotRect plot)
    {
        var axisTo = plot.DataTo;
        var span = axisTo - plot.From;
        if (span <= TimeSpan.Zero)
            return;

        var format = span < TimeSpan.FromHours(36)
            ? "HH:mm"
            : span <= TimeSpan.FromDays(8) ? "ddd HH:mm" : "dd MMM";

        const int ticks = 5;
        for (var i = 0; i < ticks; i++)
        {
            var fraction = i / (double)(ticks - 1);
            var at = plot.From + TimeSpan.FromTicks((long)(span.Ticks * fraction));
            var x = plot.XFor(at);

            canvas.Children.Add(new Line
            {
                X1 = x,
                X2 = x,
                Y1 = plot.Bottom,
                Y2 = plot.Bottom + 3,
                Stroke = new SolidColorBrush(Color.FromArgb(70, 255, 255, 255)),
                StrokeThickness = 1,
            });

            var label = new TextBlock
            {
                Text = at.ToLocalTime().ToString(format, CultureInfo.CurrentCulture),
                FontSize = 10,
                Foreground = new SolidColorBrush(Color.FromArgb(140, 255, 255, 255)),
            };
            canvas.Children.Add(label);
            label.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));

            // Clamped to the history region's own right edge, not the panel's - past a break
            // that's a much tighter boundary, and a wide label (e.g. "17 Aug") would otherwise
            // creep into the compressed future strip.
            var rightBound = Math.Max(plot.X, plot.XFor(axisTo) - label.DesiredSize.Width);
            var left = Math.Clamp(x - label.DesiredSize.Width / 2, plot.X, rightBound);
            Canvas.SetLeft(label, left);
            Canvas.SetTop(label, plot.Bottom + 5);
        }
    }

    private static void DrawWarnLine(Canvas canvas, PlotRect plot, TopLabelLayout topLabels)
    {
        var y = plot.YFor(90, 100);

        canvas.Children.Add(new Line
        {
            X1 = plot.X,
            X2 = plot.Right,
            Y1 = y,
            Y2 = y,
            Stroke = new SolidColorBrush(WithAlpha(WarnColor, 150)),
            StrokeThickness = 1,
            StrokeDashArray = [4, 3],
        });

        // Anchored at the left end of its own line, not the right - "now" and the series
        // start/reset tags tend to land on the right, and this used to sit right on top of them.
        var label = new TextBlock
        {
            Text = "90%",
            FontSize = 9,
            Foreground = new SolidColorBrush(WithAlpha(WarnColor, 200)),
        };
        topLabels.Place(canvas, label, plot.X + 2, plot.X, plot.Right, plot.Y + 1);
    }

    // The classic "broken axis" cue: two short parallel diagonal ticks where the scale changes,
    // so the compression itself (see PlotRect.HasBreak) doesn't pass as an ordinary linear axis.
    private static void DrawAxisBreak(Canvas canvas, PlotRect plot)
    {
        if (!plot.HasBreak)
            return;

        var midX = (plot.BreakStartX + plot.BreakEndX) / 2;
        var brush = new SolidColorBrush(Color.FromArgb(180, 255, 255, 255));
        foreach (var offset in new[] { -3.0, 3.0 })
        {
            canvas.Children.Add(new Line
            {
                X1 = midX + offset - 4,
                X2 = midX + offset + 4,
                Y1 = plot.Bottom + 6,
                Y2 = plot.Bottom - 6,
                Stroke = brush,
                StrokeThickness = 1.5,
            });
        }
    }

    // Marks where real data ends and projection begins. Only drawn when the axis actually
    // stretches past the data (a live view with an upcoming reset) - a scrolled-back view has no
    // future portion, so there's nothing to mark.
    private static void DrawNowMarker(Canvas canvas, PlotRect plot, DateTimeOffset dataTo, TopLabelLayout topLabels)
    {
        if (dataTo >= plot.To)
            return;

        var x = plot.XFor(dataTo);
        canvas.Children.Add(new Line
        {
            X1 = x,
            X2 = x,
            Y1 = plot.Y,
            Y2 = plot.Bottom,
            Stroke = new SolidColorBrush(Color.FromArgb(130, 255, 255, 255)),
            StrokeThickness = 1,
        });

        var label = new TextBlock
        {
            Text = "now",
            FontSize = 9,
            Foreground = new SolidColorBrush(Color.FromArgb(160, 255, 255, 255)),
        };
        topLabels.Place(canvas, label, x + 3, plot.X, plot.Right, plot.Y + 1);
    }

    // Rolling quota windows reset on a fixed cadence (5h / 7d) anchored to whatever reset time
    // the API last reported. That single anchor is enough to project every other reset in view,
    // both before and after it, without needing a reset timestamp on every sample.
    //
    // The *current* window's start and end are always drawn - they're directly derivable from
    // one known reset time and never guesswork. Repeating that backward across the whole visible
    // span is extra (and only turned on via `repeat`) precisely because it *is* extrapolation:
    // assuming every earlier cycle landed exactly `period` apart. Skip it once that would just
    // paint a stripe pattern across a wide zoom level instead of staying legible.
    // Draws a "window start" line at resetsAt minus the window's own fixed length, for every
    // distinct resetsAt value seen - that's a hard fact straight from the API (a fixed-length
    // window's start is definitionally reset minus its length), not an assumption about how one
    // cycle relates to the next. This deliberately replaced an earlier version that drew the line
    // at the *poll timestamp* that first noticed resets_at had changed: that reads fine when polls
    // are 5 minutes apart, but a gap in polling (sleep, app not running, a missed poll) straddling
    // the real rollover made the line land wherever polling happened to resume, not when the
    // window actually started. Null samples (a failed poll) are skipped rather than treated as a
    // change, so a transient API error doesn't get mistaken for a reset.
    //
    // Alongside each new window's computed start, the *previous* window's own end is drawn too -
    // that one needs no computation at all, it's the previous resetsAt value exactly as the API
    // reported it. A window doesn't necessarily begin the instant the last one ends: an idle
    // account's next window only starts on its next actual usage, not on a clock. Drawing both
    // makes a real idle gap between the two visible as a gap on the chart, instead of implying
    // (wrongly) that windows always butt up against each other back-to-back.
    //
    // The API re-stamps resets_at with a fresh sub-second fraction on every single poll even when
    // the reset itself hasn't moved (observed in history.jsonl: the same nominal reset minute
    // recorded with a different fractional second on every 5-min poll) - a raw inequality check
    // treated every poll as a rollover, drawing a boundary line on nearly every sample. Real
    // rollovers move resets_at by a whole window (hours/days), so anything under this tolerance
    // is jitter on the same reset, not a new one.
    private static readonly TimeSpan ResetJitterTolerance = TimeSpan.FromMinutes(2);

    private static void DrawWindowBoundaries(
        Canvas canvas, PlotRect plot, IReadOnlyList<UsageSample> samples,
        Func<UsageSample, DateTimeOffset?> resetSelector, Color color, string label, TimeSpan nominalPeriod, bool drawUpcoming, TopLabelLayout topLabels,
        double strokeThickness = 1.5)
    {
        DateTimeOffset? previousReset = null;

        foreach (var sample in samples)
        {
            if (resetSelector(sample) is not DateTimeOffset reset)
                continue;

            if (previousReset is not DateTimeOffset previous)
            {
                DrawBoundaryLine(canvas, plot, reset - nominalPeriod, color, $"{label} start", topLabels, strokeThickness);
            }
            else if ((reset - previous).Duration() > ResetJitterTolerance)
            {
                DrawBoundaryLine(canvas, plot, previous, color, $"{label} reset", topLabels, strokeThickness);

                // Skip the new window's own "start" line when it lands right on top of the
                // "reset" line just drawn - i.e. this window began immediately, with no idle gap.
                // The two would otherwise sit within a couple pixels of each other, doubling up on
                // the same instant instead of adding information; a genuine gap (start further out
                // than the tolerance) is the only case worth two separate lines.
                var start = reset - nominalPeriod;
                if ((start - previous).Duration() > ResetJitterTolerance)
                    DrawBoundaryLine(canvas, plot, start, color, $"{label} start", topLabels, strokeThickness);
            }

            previousReset = reset;
        }

        // The *current* window's own end is likewise a fact the API reports directly for the
        // window still running, not an extrapolation - just optional per series (see the 5h call
        // site) since a reset that fires every few hours doesn't need its own line every time.
        if (previousReset is DateTimeOffset current && drawUpcoming)
            DrawBoundaryLine(canvas, plot, current, color, $"{label} reset", topLabels, strokeThickness);
    }

    private static void DrawBoundaryLine(Canvas canvas, PlotRect plot, DateTimeOffset t, Color color, string label, TopLabelLayout topLabels, double strokeThickness = 1.5)
    {
        if (t < plot.From || t > plot.To)
            return;

        // Bold and opaque rather than the faint hairline first tried here - against a busy chart
        // (grid, series, warn line) a thin 35%-alpha dash all but disappeared, which read as "not
        // drawn at all" even though it technically was.
        var stroke = new SolidColorBrush(color);

        var x = plot.XFor(t);
        canvas.Children.Add(new Line
        {
            X1 = x,
            X2 = x,
            Y1 = plot.Y,
            Y2 = plot.Bottom,
            Stroke = stroke,
            StrokeThickness = strokeThickness,
            StrokeDashArray = [4, 2],
        });

        var tag = new TextBlock
        {
            Text = label,
            FontSize = 9,
            Foreground = stroke,
        };
        topLabels.Place(canvas, tag, x + 3, plot.X, plot.Right, plot.Y + 1);
    }

    // Fits the *rate* of increase (%/second) through this window's samples so far, then projects
    // forward from the actual latest reading to either the moment it crosses 100% (if that
    // happens before the window resets) or to the reset itself. Drawn as a dashed continuation of
    // the series' own line, plus a plain-language readout - the chart alone doesn't say "this
    // resets before it matters" clearly enough.
    private static void AddPrediction(
        List<string> predictions, List<PredictionMarker> markers, Canvas canvas, PlotRect plot, IReadOnlyList<UsageSample> samples,
        string label, Color color, Func<UsageSample, double?> valueSelector,
        Func<UsageSample, DateTimeOffset?> resetSelector, DateTimeOffset now)
    {
        UsageSample? latest = null;
        for (var i = samples.Count - 1; i >= 0 && latest is null; i--)
        {
            if (valueSelector(samples[i]) is not null)
                latest = samples[i];
        }

        if (latest is null || valueSelector(latest) is not double currentValue)
            return;

        var currentPercent = UsageFormat.Percent(currentValue);
        var resetsAt = resetSelector(latest);
        if (resetsAt is not DateTimeOffset reset || reset <= now)
        {
            predictions.Add($"{label}: {currentPercent}%");
            return;
        }

        // Which SAMPLES belong to this window is decided by matching each sample's own reported
        // resetsAt against the current one - not by "is this sample's timestamp after some
        // computed window start". Windows aren't guaranteed to butt up back-to-back (an idle
        // account's next window doesn't start the instant the last one ends), so filtering by a
        // computed timestamp risked pulling the *previous* window's tail into this regression
        // whenever there's a gap between the two - silently skewing the projected endpoint with
        // data that belongs to a different cycle entirely. Seconds are measured relative to the
        // *latest* sample (0 at "now", negative going back) rather than the window's start, so the
        // fit's own choice of origin never has to be exact for what follows to be correct.
        var points = samples
            .Where(s => resetSelector(s) is DateTimeOffset r && (r - reset).Duration() <= ResetJitterTolerance
                        && s.Timestamp <= now && valueSelector(s) is not null)
            .Select(s => (Seconds: (s.Timestamp - latest.Timestamp).TotalSeconds, Value: valueSelector(s)!.Value))
            .ToList();

        double? ratePerSecond = null;
        if (points.Count >= 2 && points[^1].Seconds - points[0].Seconds >= MinTrendSpan.TotalSeconds)
        {
            var n = points.Count;
            var sumX = points.Sum(p => p.Seconds);
            var sumY = points.Sum(p => p.Value);
            var sumXY = points.Sum(p => p.Seconds * p.Value);
            var sumXX = points.Sum(p => p.Seconds * p.Seconds);
            var denominator = n * sumXX - sumX * sumX;
            if (Math.Abs(denominator) > 1e-6)
                ratePerSecond = (n * sumXY - sumX * sumY) / denominator;
        }

        // Projected forward from the actual latest reading, not from the fit's own value at "now"
        // - a least-squares line doesn't have to pass through the last point, and utilization only
        // ever climbs within a window (it's cumulative usage against a quota), so anchoring here
        // and clamping the floor to currentValue guarantees the projection can never read below
        // what's already been observed, regardless of where the fitted line happens to sit.
        DateTimeOffset? projectedFullAt = null;
        double projectedAtReset;
        if (ratePerSecond is double rate && rate > 1e-9)
        {
            var secondsToReset = (reset - latest.Timestamp).TotalSeconds;
            projectedAtReset = Math.Clamp(currentValue + rate * secondsToReset, currentValue, 100);

            var secondsTo100 = (100 - currentValue) / rate;
            var full = latest.Timestamp + TimeSpan.FromSeconds(secondsTo100);
            if (full > now && full <= reset)
                projectedFullAt = full;
        }
        else
        {
            projectedAtReset = currentValue;
        }

        var targetTime = projectedFullAt ?? reset;
        var targetValue = projectedFullAt is not null ? 100 : projectedAtReset;

        var from = new Point(plot.XFor(latest.Timestamp), plot.YFor(currentValue, 100));
        var to = new Point(plot.XFor(targetTime), plot.YFor(targetValue, 100));
        canvas.Children.Add(new Line
        {
            X1 = from.X,
            X2 = to.X,
            Y1 = from.Y,
            Y2 = to.Y,
            Stroke = new SolidColorBrush(WithAlpha(color, 200)),
            StrokeThickness = 2,
            StrokeDashArray = [5, 3],
        });
        markers.Add(new PredictionMarker(label, color, from.X, latest.Timestamp, currentValue, to.X, targetTime, targetValue));

        // A hollow marker for a projection still inside the visible range; an arrow pinned to the
        // right edge when it's clipped, so "still climbing off-screen" reads differently from
        // "this is where it lands".
        if (targetTime <= plot.To)
        {
            var marker = new Ellipse
            {
                Width = 7,
                Height = 7,
                Stroke = new SolidColorBrush(color),
                StrokeThickness = 1.5,
                Fill = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            };
            canvas.Children.Add(marker);
            Canvas.SetLeft(marker, to.X - 3.5);
            Canvas.SetTop(marker, to.Y - 3.5);

            // When the projection crosses 100% before the window's own reset, the hollow marker
            // above sits at that earlier crossing point, not at the reset - so on its own it reads
            // as "capped, full stop", with no indication the window clears again later. A small
            // filled dot at the reset's own x (same row) marks when that actually happens.
            if (projectedFullAt is not null && reset <= plot.To)
            {
                var resetX = plot.XFor(reset);
                var resetDot = new Ellipse
                {
                    Width = 4,
                    Height = 4,
                    Fill = new SolidColorBrush(color),
                };
                canvas.Children.Add(resetDot);
                Canvas.SetLeft(resetDot, resetX - 2);
                Canvas.SetTop(resetDot, to.Y - 2);
            }
        }
        else
        {
            var arrow = new Polygon
            {
                Fill = new SolidColorBrush(color),
                Points = { new Point(0, -4), new Point(6, 0), new Point(0, 4) },
            };
            canvas.Children.Add(arrow);
            Canvas.SetLeft(arrow, plot.Right - 6);
            Canvas.SetTop(arrow, to.Y);
        }

        predictions.Add(projectedFullAt is DateTimeOffset fullAt
            ? $"{label}: on pace to hit 100% around {fullAt.ToLocalTime():HH:mm} (resets {reset.ToLocalTime():HH:mm})"
            : $"{label}: on pace for ~{Math.Round(projectedAtReset):0}% at reset ({reset.ToLocalTime():HH:mm})");
    }

    // Distinguishes "nothing has ever been recorded" from "nothing was recorded in the slice
    // you're currently looking at" - scrolling into a stretch that predates the tray running (or
    // any gap) is not the same situation as a genuinely empty history file.
    private static string EmptyStateMessage(IReadOnlyList<UsageSample> samples) => samples.Count == 0
        ? "No history yet - samples are recorded every 5 minutes"
        : "No data in this time range";

    private static void DrawEmptyState(Canvas canvas, string message)
    {
        var label = new TextBlock
        {
            Text = message,
            FontSize = 12,
            Foreground = new SolidColorBrush(Color.FromArgb(140, 255, 255, 255)),
        };
        canvas.Children.Add(label);
        label.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        Canvas.SetLeft(label, Math.Max(0, (canvas.ActualWidth - label.DesiredSize.Width) / 2));
        Canvas.SetTop(label, Math.Max(0, (canvas.ActualHeight - label.DesiredSize.Height) / 2));
    }

    private static Polyline NewPolyline(List<Point> points, Color color, bool dashed = false)
    {
        var line = new Polyline
        {
            Stroke = new SolidColorBrush(color),
            StrokeThickness = 2,
            StrokeLineJoin = PenLineJoin.Round,
        };
        if (dashed)
            line.StrokeDashArray = [4, 3];
        foreach (var point in points)
            line.Points.Add(point);
        return line;
    }

    // A one-point run would be an invisible polyline, so it gets a dot instead.
    private static void AddDot(Canvas canvas, Point at, Color color)
    {
        var dot = new Ellipse { Width = 6, Height = 6, Fill = new SolidColorBrush(color) };
        canvas.Children.Add(dot);
        Canvas.SetLeft(dot, at.X - 3);
        Canvas.SetTop(dot, at.Y - 3);
    }

    private static bool TryGetPlotRect(Canvas canvas, DateTimeOffset from, DateTimeOffset dataTo, DateTimeOffset to, out PlotRect plot)
    {
        if (canvas.ActualWidth < 80 || canvas.ActualHeight < 40 || to <= from)
        {
            plot = default;
            return false;
        }

        plot = GetPlotRect(canvas.ActualWidth, canvas.ActualHeight, from, dataTo, to);
        return true;
    }

    private static PlotRect GetPlotRect(double width, double height, DateTimeOffset from, DateTimeOffset dataTo, DateTimeOffset to) =>
        new(LeftGutter, TopInset, Math.Max(1, width - LeftGutter - RightInset), Math.Max(1, height - TopInset - BottomInset), from, dataTo, to);

    private static double? ToGigabytes(long? bytes) => bytes is long b ? b / (1024.0 * 1024 * 1024) : null;

    private static Color WithAlpha(Color color, byte alpha) => Color.FromArgb(alpha, color.R, color.G, color.B);

    private static TimeSpan Max(TimeSpan a, TimeSpan b) => a >= b ? a : b;

    // DataTo marks where real samples end and the live projection begins (equal to To when
    // there's no future stretch, e.g. a scrolled-back view). XFor uses that to decide whether the
    // axis is a single linear scale or two: history gets almost the full width once the future
    // portion is compressed, rather than both scaling together and squeezing history to a sliver.
    private readonly record struct PlotRect(double X, double Y, double Width, double Height, DateTimeOffset From, DateTimeOffset DataTo, DateTimeOffset To)
    {
        public double Right => X + Width;
        public double Bottom => Y + Height;

        public bool HasBreak => To > DataTo && UncompressedFutureWidth > FutureStripWidthPx;

        private double UncompressedFutureWidth
        {
            get
            {
                var total = (To - From).TotalSeconds;
                return total <= 0 ? 0 : (To - DataTo).TotalSeconds / total * Width;
            }
        }

        private double HistoryWidth => HasBreak ? Math.Max(1, Width - FutureStripWidthPx - BreakGapWidthPx) : Width;

        public double BreakStartX => X + HistoryWidth;
        public double BreakEndX => BreakStartX + BreakGapWidthPx;

        public double XFor(DateTimeOffset at)
        {
            if (!HasBreak)
            {
                var total = (To - From).TotalSeconds;
                return total <= 0 ? X : X + Math.Clamp((at - From).TotalSeconds / total, 0, 1) * Width;
            }

            if (at <= DataTo)
            {
                var historySeconds = (DataTo - From).TotalSeconds;
                return historySeconds <= 0 ? X : X + Math.Clamp((at - From).TotalSeconds / historySeconds, 0, 1) * HistoryWidth;
            }

            var futureSeconds = (To - DataTo).TotalSeconds;
            return futureSeconds <= 0 ? BreakEndX : BreakEndX + Math.Clamp((at - DataTo).TotalSeconds / futureSeconds, 0, 1) * FutureStripWidthPx;
        }

        public double YFor(double value, double max) =>
            max <= 0 ? Bottom : Bottom - Math.Clamp(value / max, 0, 1) * Height;
    }

    // "now", the 90% warn line, and each series' start/reset tag all want to sit near the top of
    // the quota chart, and often land close together on the x-axis - live, "now" and an imminent
    // reset can be only a few pixels apart, and a fresh history draws several series' fallback
    // "start" tags at once. Sharing one of these across all of them lets colliding tags stack
    // into their own row instead of being drawn straight through each other.
    private sealed class TopLabelLayout
    {
        private const double RowHeight = 12;
        private readonly List<List<(double Left, double Right)>> _rows = [];

        public void Place(Canvas canvas, TextBlock label, double preferredLeft, double minLeft, double maxRight, double baseTop)
        {
            canvas.Children.Add(label);
            label.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            var width = label.DesiredSize.Width;
            var left = Math.Clamp(preferredLeft, minLeft, Math.Max(minLeft, maxRight - width));
            var right = left + width;

            var row = 0;
            while (row < _rows.Count && _rows[row].Any(span => Overlaps(span, left, right)))
                row++;

            if (row == _rows.Count)
                _rows.Add([]);
            _rows[row].Add((left, right));

            Canvas.SetLeft(label, left);
            Canvas.SetTop(label, baseTop + row * RowHeight);
        }

        // A couple of px of breathing room so adjacent tags don't end up touching edge-to-edge.
        private static bool Overlaps((double Left, double Right) span, double left, double right) =>
            left < span.Right + 2 && span.Left < right + 2;
    }

    private sealed class Bucket(DateTimeOffset center)
    {
        public DateTimeOffset Center { get; } = center;
        public bool HasData { get; private set; }
        public double? FiveHour { get; private set; }
        public double? SevenDay { get; private set; }
        public double? SevenDaySonnet { get; private set; }
        public long? MemoryBytes { get; private set; }
        public long? PagedMemoryBytes { get; private set; }
        public int? SessionCount { get; private set; }

        public void Add(UsageSample sample)
        {
            HasData = true;
            FiveHour = Peak(FiveHour, sample.FiveHour);
            SevenDay = Peak(SevenDay, sample.SevenDay);
            SevenDaySonnet = Peak(SevenDaySonnet, sample.SevenDaySonnet);
            MemoryBytes = Peak(MemoryBytes, sample.MemoryBytes);
            PagedMemoryBytes = Peak(PagedMemoryBytes, sample.PagedMemoryBytes);
            SessionCount = Peak(SessionCount, sample.SessionCount);
        }

        private static double? Peak(double? a, double? b) => a is null ? b : b is null ? a : Math.Max(a.Value, b.Value);
        private static long? Peak(long? a, long? b) => a is null ? b : b is null ? a : Math.Max(a.Value, b.Value);
        private static int? Peak(int? a, int? b) => a is null ? b : b is null ? a : Math.Max(a.Value, b.Value);
    }
}
