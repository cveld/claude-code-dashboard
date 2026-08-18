namespace ClaudeTokenTray;

// One poll's worth of indicators. Every value is nullable: a poll can fail for the usage API
// while the memory reading succeeds (and vice versa), and a gap must stay a gap in the charts
// rather than being interpolated away.
public sealed record UsageSample(
    DateTimeOffset Timestamp,
    double? FiveHour,
    double? SevenDay,
    double? SevenDaySonnet,
    long? MemoryBytes,
    long? PagedMemoryBytes,
    int? SessionCount,
    DateTimeOffset? FiveHourResetsAt = null,
    DateTimeOffset? SevenDayResetsAt = null,
    DateTimeOffset? SevenDaySonnetResetsAt = null);
