using System.Globalization;
using System.Text;
using System.Text.Json;

namespace ClaudeTokenTray;

// Append-only JSON Lines log of poll samples, so the tray can chart indicators over time.
// Compact property names keep 30 days of 5-minute samples around 1 MB.
public static class UsageHistoryStore
{
    private static readonly Lock Gate = new();

    public static string FilePath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ClaudeTokenTray",
        "history.jsonl");

    public static void Append(UsageSample sample)
    {
        if (sample.FiveHour is null &&
            sample.SevenDay is null &&
            sample.SevenDaySonnet is null &&
            sample.MemoryBytes is null &&
            sample.PagedMemoryBytes is null &&
            sample.SessionCount is null)
        {
            return;
        }

        lock (Gate)
        {
            try
            {
                var dir = Path.GetDirectoryName(FilePath);
                if (string.IsNullOrWhiteSpace(dir))
                    return;

                Directory.CreateDirectory(dir);

                using var stream = new FileStream(FilePath, FileMode.Append, FileAccess.Write, FileShare.Read);
                using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                writer.WriteLine(SerializeLine(sample));
            }
            catch
            {
                // history is best-effort: never take the tray down over it
            }
        }
    }

    public static IReadOnlyList<UsageSample> Load(DateTimeOffset since)
    {
        lock (Gate)
        {
            try
            {
                if (!File.Exists(FilePath))
                    return [];

                var samples = new List<UsageSample>();
                foreach (var line in File.ReadLines(FilePath))
                {
                    if (TryParseLine(line, out var sample) && sample.Timestamp >= since)
                        samples.Add(sample);
                }

                samples.Sort(static (a, b) => a.Timestamp.CompareTo(b.Timestamp));
                return samples;
            }
            catch
            {
                return [];
            }
        }
    }

    // Rewrites through a temp file so a crash mid-prune can't truncate the history.
    public static void Prune(TimeSpan retention)
    {
        lock (Gate)
        {
            try
            {
                if (!File.Exists(FilePath))
                    return;

                var cutoff = DateTimeOffset.Now - retention;
                var kept = new List<UsageSample>();
                var dropped = 0;

                foreach (var line in File.ReadLines(FilePath))
                {
                    if (TryParseLine(line, out var sample) && sample.Timestamp >= cutoff)
                        kept.Add(sample);
                    else
                        dropped++;
                }

                if (dropped == 0)
                    return;

                var dir = Path.GetDirectoryName(FilePath);
                if (string.IsNullOrWhiteSpace(dir))
                    return;

                var tempPath = Path.Combine(dir, $"history.{Guid.NewGuid():N}.tmp");
                using (var stream = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)))
                {
                    foreach (var sample in kept)
                        writer.WriteLine(SerializeLine(sample));
                }

                File.Move(tempPath, FilePath, overwrite: true);
            }
            catch
            {
                // leave the file as-is on failure
            }
        }
    }

    private static string SerializeLine(UsageSample sample)
    {
        using var buffer = new MemoryStream();
        using (var json = new Utf8JsonWriter(buffer))
        {
            json.WriteStartObject();
            json.WriteString("t", sample.Timestamp.ToString("O", CultureInfo.InvariantCulture));
            if (sample.FiveHour is double fiveHour) json.WriteNumber("h5", fiveHour);
            if (sample.SevenDay is double sevenDay) json.WriteNumber("d7", sevenDay);
            if (sample.SevenDaySonnet is double sonnet) json.WriteNumber("d7s", sonnet);
            if (sample.MemoryBytes is long memory) json.WriteNumber("mem", memory);
            if (sample.PagedMemoryBytes is long paged) json.WriteNumber("paged", paged);
            if (sample.SessionCount is int sessions) json.WriteNumber("sessions", sessions);
            if (sample.FiveHourResetsAt is DateTimeOffset h5r) json.WriteString("h5r", h5r.ToString("O", CultureInfo.InvariantCulture));
            if (sample.SevenDayResetsAt is DateTimeOffset d7r) json.WriteString("d7r", d7r.ToString("O", CultureInfo.InvariantCulture));
            if (sample.SevenDaySonnetResetsAt is DateTimeOffset d7sr) json.WriteString("d7sr", d7sr.ToString("O", CultureInfo.InvariantCulture));
            json.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private static bool TryParseLine(string line, out UsageSample sample)
    {
        sample = null!;
        if (string.IsNullOrWhiteSpace(line))
            return false;

        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return false;

            if (!root.TryGetProperty("t", out var timestampProp) ||
                timestampProp.ValueKind != JsonValueKind.String ||
                !DateTimeOffset.TryParse(timestampProp.GetString(), CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var timestamp))
            {
                return false;
            }

            sample = new UsageSample(
                timestamp,
                ReadDouble(root, "h5"),
                ReadDouble(root, "d7"),
                ReadDouble(root, "d7s"),
                ReadInt64(root, "mem"),
                ReadInt64(root, "paged"),
                ReadInt32(root, "sessions"),
                ReadDateTimeOffset(root, "h5r"),
                ReadDateTimeOffset(root, "d7r"),
                ReadDateTimeOffset(root, "d7sr"));
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static double? ReadDouble(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number && p.TryGetDouble(out var v) ? v : null;

    private static long? ReadInt64(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number && p.TryGetInt64(out var v) ? v : null;

    private static int? ReadInt32(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out var v) ? v : null;

    private static DateTimeOffset? ReadDateTimeOffset(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String &&
        DateTimeOffset.TryParse(p.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var v)
            ? v
            : null;
}
