namespace ClaudeTokenTray;

// Shared formatting for the tray tooltip and the history window, so the two never disagree
// about how a percentage, a byte count or a reset time is written.
internal static class UsageFormat
{
    public static int? Percent(UsageLimitWindow? window) =>
        window is null ? null : Math.Clamp((int)Math.Round(window.Utilization), 0, 100);

    public static int Percent(double utilization) => Math.Clamp((int)Math.Round(utilization), 0, 100);

    public static string? TimeRemaining(DateTimeOffset? resetsAt)
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
            var remainingHours = hours % 24;
            return remainingHours > 0 ? $"{days}d{remainingHours}h" : $"{days}d";
        }

        return hours > 0 ? $"{hours}h{(minutes > 0 ? $"{minutes}m" : "")}" : $"{minutes}m";
    }

    public static string Bytes(long bytes)
    {
        const double gb = 1024.0 * 1024 * 1024;
        const double mb = 1024.0 * 1024;
        return bytes >= gb ? $"{bytes / gb:0.0} GB" : $"{Math.Round(bytes / mb)} MB";
    }

    public static string MemorySummary(SessionMemoryUsage memory) =>
        $"{Sessions(memory.SessionCount)} · {Bytes(memory.TotalMemoryBytes)} RAM · {Bytes(memory.TotalPagedMemoryBytes)} paged";

    public static string Sessions(int count) => $"{count} session{(count == 1 ? "" : "s")}";
}
